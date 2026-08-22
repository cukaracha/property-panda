"""EXTRACT role tools — record and verify what the subagent read off a page.

This is the stage the port actually moves. The retired Lambda sent prompt P1 to
Bedrock and parsed the JSON back; here the subagent is handed the page text in its
opening prompt and produces the same `{e, ev_, r, cl}` structure itself, on the
caller's own Claude subscription. What it produces is then put through exactly the
deterministic verifier the Lambda ran, with no second opinion from any model:

- every item's evidence anchor is matched back to the page text (exact, then
  normalized); an item whose anchor does not match was hallucinated and is dropped.
  Matching uses the whole anchor the model sent, and only the stored copy is cut to
  `MAX_ANCHOR_CHARS`, so shortening what is kept never weakens what is checked
- a matched item's char offset resolves to its containing chunk
- an event is validated like an entity carrying a date, and its date is synthesized
  into a `date` identifier node plus an `occurred_on` relation, so events bridge
  documents through shared dates
- a relation is kept only if both endpoints were themselves extracted on that page

Keeping the verifier in a tool rather than a prompt is the whole safety argument:
the subagent cannot talk its way past an anchor that does not exist in the page.

The pages themselves are written before the agent is invoked: segmentation is
deterministic and runs in the state machine, so what `batch_page` hands over is what
is already in gold rather than anything a role produced.

A batch's inputs are fetched once up front rather than per tool call. `prime_batch`
reads the manifest a single time and pulls the batch's pages in parallel before the
model runs; `batch_page` and `record_extraction` both resolve through that cache and
fall back to a one-off read on a miss, so the tools stay correct unprimed.
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor

from shared import artifacts, keys, locate, status
from .common import make_tool, respond
from .context import RunContext

READ_WORKERS = 10

# What a stored anchor is allowed to cost. The anchor has two jobs, finding the item
# on the page and showing a reader why it was kept, and 60 characters does both. The
# charter asks for the first 6-12 words and the model reliably writes half as much
# again, so this is a ceiling on the overshoot rather than the intent. Matching still
# runs against the full anchor the model sent, so the verifier is exactly as strict as
# it was and only the stored copy is shorter.
MAX_ANCHOR_CHARS = 60

# Prefetched batch inputs, keyed by run prefix. One entry at a time: an extract
# invocation handles exactly one batch, and `release_batch` clears it before the
# warm microVM is handed the next one.
_BATCH_CACHE: dict = {}


def read_manifest(ctx: RunContext) -> list:
    return artifacts.read_json(artifacts.resolve(ctx.run_prefix, 'pages/manifest.json'))


def prime_batch(ctx: RunContext, page_ids: list) -> list:
    """Fetch one batch's manifest entries and page bodies up front.

    Returns the ids that exist in the manifest. An id that does not is not this
    batch's to extract, and reporting it here is what lets the caller say so rather
    than the model discovering it one failed tool call at a time.
    """
    manifest = {entry['pageId']: entry for entry in read_manifest(ctx)}
    entries = {page_id: manifest[page_id] for page_id in page_ids if page_id in manifest}
    pages = {}
    if entries:
        with ThreadPoolExecutor(max_workers=min(len(entries), READ_WORKERS)) as pool:
            bodies = pool.map(lambda e: artifacts.read_json(e['pageUri']), entries.values())
            pages = dict(zip(entries.keys(), bodies))
    _BATCH_CACHE[ctx.run_prefix] = {'entries': entries, 'pages': pages}
    return list(entries.keys())


def release_batch(ctx: RunContext) -> None:
    _BATCH_CACHE.pop(ctx.run_prefix, None)


def _entry(ctx: RunContext, page_id: str) -> dict:
    cached = _BATCH_CACHE.get(ctx.run_prefix, {}).get('entries', {})
    if page_id in cached:
        return cached[page_id]
    manifest = {entry['pageId']: entry for entry in read_manifest(ctx)}
    if page_id not in manifest:
        raise ValueError(f"{page_id} is not a page in this build")
    return manifest[page_id]


def _page(ctx: RunContext, page_id: str) -> dict:
    cached = _BATCH_CACHE.get(ctx.run_prefix, {}).get('pages', {})
    if page_id in cached:
        return cached[page_id]
    return artifacts.read_json(_entry(ctx, page_id)['pageUri'])


def batch_page(ctx: RunContext, page_id: str) -> dict:
    """One primed page body, so the caller can put the text in the opening prompt.

    The pages are already in hand by the time the model runs, so handing them over
    directly is one fewer turn and one fewer tool hop than letting the model ask for
    each one.
    """
    return _page(ctx, page_id)


def _anchor(value) -> str:
    """The stored form of an evidence anchor, cut to the budget at a word boundary."""
    text = str(value or '').strip()
    if len(text) <= MAX_ANCHOR_CHARS:
        return text
    cut = text[:MAX_ANCHOR_CHARS]
    return cut.rsplit(' ', 1)[0] or cut


def _locate(anchor, page_text, chunks):
    """Return (char_offset, chunk_id) for an anchor, or (None, None) if unmatched."""
    offset = locate.find_offset(page_text, anchor or '')
    if offset < 0:
        return None, None
    return offset, locate.chunk_for_offset(offset, chunks)


def _validate_entities(raw_entities, page_id, doc_id, page_text, chunks, counts):
    """Keep entities whose anchor matches; attach offset/chunk and a per-page id."""
    entities, by_name, by_norm, id_to_type = [], {}, {}, {}
    for idx, ent in enumerate(raw_entities):
        if not isinstance(ent, dict) or not ent.get('n'):
            continue
        offset, chunk_id = _locate(ent.get('ev'), page_text, chunks)
        if offset is None:
            counts['anchor_fail'] += 1
            continue
        name = str(ent['n']).strip()
        entity_id = f"{page_id}#e{idx}"
        entities.append({
            'id': entity_id,
            'name': name,
            'type': str(ent.get('t', 'other')).strip().lower(),
            'norm': (str(ent['norm']).strip() if ent.get('norm') else None),
            'ev': _anchor(ent.get('ev')),
            'char_offset': offset,
            'chunk_id': chunk_id,
            'page_id': page_id,
            'doc_id': doc_id,
        })
        by_name.setdefault(name, entity_id)
        by_norm.setdefault(keys.collapse(name), entity_id)
        id_to_type[entity_id] = entities[-1]['type']
    return entities, by_name, by_norm, id_to_type


def _validate_events(raw_events, page_id, doc_id, page_text, chunks,
                     entities, by_name, by_norm, id_to_type, counts):
    """Validate events into date-carrying entities; synthesize date nodes and occurred_on relations.

    An event is an entity carrying a `date`; the date is minted as its own "date"
    identifier entity (keyed by the ISO norm, so a shared date bridges documents) and
    wired to the event with a pre-resolved `occurred_on` relation. Mutates the shared
    entity lists so a model relation can resolve an event by its label.
    """
    synthetic_relations = []
    for idx, ev in enumerate(raw_events):
        if not isinstance(ev, dict) or not ev.get('n'):
            continue
        offset, chunk_id = _locate(ev.get('ev'), page_text, chunks)
        if offset is None:
            counts['anchor_fail'] += 1
            continue
        name = str(ev['n']).strip()
        date_iso = str(ev['date']).strip() if ev.get('date') else ''
        event_type = str(ev.get('t', 'event')).strip().lower()
        event_id = f"{page_id}#v{idx}"
        entities.append({
            'id': event_id,
            'name': name,
            'type': event_type,
            'norm': None,
            'ev': _anchor(ev.get('ev')),
            'char_offset': offset,
            'chunk_id': chunk_id,
            'page_id': page_id,
            'doc_id': doc_id,
            'date': date_iso,
        })
        by_name.setdefault(name, event_id)
        by_norm.setdefault(keys.collapse(name), event_id)
        id_to_type[event_id] = event_type
        counts['events_kept'] += 1

        if not date_iso:
            continue
        date_id = f"{page_id}#vd{idx}"
        entities.append({
            'id': date_id,
            'name': date_iso,
            'type': 'date',
            'norm': date_iso,
            'ev': _anchor(ev.get('ev')),
            'char_offset': offset,
            'chunk_id': chunk_id,
            'page_id': page_id,
            'doc_id': doc_id,
        })
        by_name.setdefault(date_iso, date_id)
        by_norm.setdefault(keys.collapse(date_iso), date_id)
        id_to_type[date_id] = 'date'
        synthetic_relations.append({
            'id': f"{page_id}#vr{idx}",
            's_id': event_id, 'o_id': date_id,
            's': name, 'o': date_iso,
            'p': 'occurred_on',
            's_type': entities[-2]['type'], 'o_type': 'date',
            'ev': _anchor(ev.get('ev')),
            'char_offset': offset,
            'chunk_id': chunk_id,
            'page_id': page_id,
            'doc_id': doc_id,
            'q': None,
            'tm': None,
        })
    return synthetic_relations


def _validate_relations(raw_relations, page_id, doc_id, page_text, chunks,
                        by_name, by_norm, id_to_type, counts):
    """Keep relations whose anchor matches and whose endpoints were both extracted."""
    def resolve(name):
        if name in by_name:
            return by_name[name]
        return by_norm.get(keys.collapse(name or ''))

    relations = []
    for idx, rel in enumerate(raw_relations):
        if not isinstance(rel, dict) or not (rel.get('s') and rel.get('p') and rel.get('o')):
            continue
        offset, chunk_id = _locate(rel.get('ev'), page_text, chunks)
        if offset is None:
            counts['anchor_fail'] += 1
            continue
        s_id, o_id = resolve(str(rel['s'])), resolve(str(rel['o']))
        if not s_id or not o_id:
            counts['relations_dropped_endpoint'] += 1
            continue
        relations.append({
            'id': f"{page_id}#r{idx}",
            's_id': s_id, 'o_id': o_id,
            's': str(rel['s']).strip(), 'o': str(rel['o']).strip(),
            'p': str(rel['p']).strip().lower(),
            's_type': id_to_type.get(s_id, 'other'),
            'o_type': id_to_type.get(o_id, 'other'),
            'ev': _anchor(rel.get('ev')),
            'char_offset': offset,
            'chunk_id': chunk_id,
            'page_id': page_id,
            'doc_id': doc_id,
            'q': rel.get('q') or None,
            'tm': rel.get('tm') or None,
        })
    return relations


def extract_tools(ctx: RunContext) -> list:
    async def record_extraction(args: dict) -> dict:
        page_id = args['page_id']
        raw_e = args.get('entities') or []
        raw_ev = args.get('events') or []
        raw_r = args.get('relations') or []
        raw_cl = args.get('class_terms') or []

        entry = _entry(ctx, page_id)
        page = _page(ctx, page_id)
        page_text = page['text']
        doc_id = page['doc_id']
        chunks = entry.get('chunks', [])

        counts = {'anchor_fail': 0, 'relations_dropped_endpoint': 0, 'events_kept': 0}
        entities, by_name, by_norm, id_to_type = _validate_entities(
            raw_e, page_id, doc_id, page_text, chunks, counts)
        named_entities = len(entities)
        synthetic_relations = _validate_events(
            raw_ev, page_id, doc_id, page_text, chunks,
            entities, by_name, by_norm, id_to_type, counts)
        relations = synthetic_relations + _validate_relations(
            raw_r, page_id, doc_id, page_text, chunks, by_name, by_norm, id_to_type, counts)

        counts.update({
            'entities_total': len(raw_e),
            'entities_kept': named_entities,
            'events_total': len(raw_ev),
            'relations_total': len(raw_r),
            'relations_kept': len(relations),
            'items_total': len(raw_e) + len(raw_ev) + len(raw_r),
        })

        # Independent writes, and every tool handler here blocks the one event loop,
        # so the S3 PUT and the progress counter go out together off-thread.
        await asyncio.gather(
            asyncio.to_thread(
                artifacts.write_json,
                artifacts.resolve(ctx.run_prefix, f"elements/{page_id}.json"),
                {
                    'page_id': page_id,
                    'doc_id': doc_id,
                    'entities': entities,
                    'relations': relations,
                    'class_terms': [c for c in raw_cl if isinstance(c, dict)],
                    'counts': counts,
                },
            ),
            asyncio.to_thread(status.increment_done, ctx.job_id),
        )
        ctx.recorded_pages.add(page_id)

        return respond({
            'pageId': page_id,
            'entitiesKept': named_entities,
            'relationsKept': len(relations),
            'anchorFail': counts['anchor_fail'],
            'relationsDroppedEndpoint': counts['relations_dropped_endpoint'],
        })

    async def report_progress(_args: dict) -> dict:
        # Scoped to the batch that was handed over, so this costs nothing: the pages
        # are known and what has been recorded is already in hand. Listing the whole
        # `elements/` prefix on every call is what made the old fan-in expensive.
        if ctx.page_ids:
            pending = [page_id for page_id in ctx.page_ids
                       if page_id not in ctx.recorded_pages]
            return respond({
                'total': len(ctx.page_ids),
                'done': len(ctx.page_ids) - len(pending),
                'pending': pending,
                'pendingCount': len(pending),
            })

        manifest = read_manifest(ctx)
        recorded = {
            uri.rsplit('/', 1)[-1][: -len('.json')]
            for uri in artifacts.list_keys(artifacts.resolve(ctx.run_prefix, 'elements/'))
            if uri.endswith('.json')
        }
        pending = [entry['pageId'] for entry in manifest if entry['pageId'] not in recorded]
        return respond({
            'total': len(manifest),
            'done': len(manifest) - len(pending),
            'pending': pending[:100],
            'pendingCount': len(pending),
        })

    return [
        make_tool(
            'record_extraction',
            (
                'Record what you extracted from one page. Every item is verified against the page '
                'text before it is kept: an evidence anchor that does not appear on the page is '
                'discarded as a hallucination, and a relation whose endpoints were not both '
                'extracted is dropped. Returns what survived.'
            ),
            {
                'type': 'object',
                'properties': {
                    'page_id': {'type': 'string'},
                    'entities': {'type': 'array', 'items': {'type': 'object'}},
                    'events': {'type': 'array', 'items': {'type': 'object'}},
                    'relations': {'type': 'array', 'items': {'type': 'object'}},
                    'class_terms': {'type': 'array', 'items': {'type': 'object'}},
                },
                'required': ['page_id', 'entities', 'events', 'relations', 'class_terms'],
            },
            record_extraction,
        ),
        make_tool(
            'report_progress',
            'How many pages have been recorded so far, and which are still pending.',
            {},
            report_progress,
        ),
    ]
