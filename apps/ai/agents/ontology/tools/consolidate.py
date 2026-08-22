"""CONSOLIDATE role tools — build the canonical type/predicate schema.

The retired Lambda embedded the raw vocabulary, clustered it, and then sent prompts
P2A/P2B to Bedrock to make the merges. Here the clustering still runs on Titan
embeddings, but its output is handed to the subagent as *suggestions only* and the
subagent makes every actual merge. That split is deliberate and load-bearing:
inverses (`employs` / `employed_by`), opposites (`approved` / `rejected`), and
different identifier kinds (`phone` / `fax`) all score high on cosine similarity and
must never be silently joined, which is exactly the judgement an embedding cannot
make and the P2A/P2B charters spell out.

Types and predicates are designed by two runs at once, and each commits its own half.
Designing both in one turn was the build's single longest stretch, and the two halves
share almost nothing: the type rules are about roles and merges, the predicate rules
are about direction and inverses. The one real coupling is that a predicate's domain
and range name types the other run is deciding at the same moment, so the predicate
run states them in RAW strings and `merge_consolidation` resolves them through the
type run's `type_map`. That is deterministic, and it is less to get wrong than asking
a model to carry the raw-to-canonical mapping in its head while writing the list.

Each half commits a part file and nothing else. `merge_consolidation` is what writes
`schema.json` and `maps.json`, so the two artifacts the invocation checks for can only
exist once both halves are in. Everything that spans the halves lives there:
`_inject_reserved_vocab`, the domain/range resolution, and the counts.

Both commits keep every deterministic override the Lambda had, so the subagent cannot
break an invariant by returning a plausible-looking schema:

- `_inject_reserved_vocab` forces the pipeline-minted `date` type and `occurred_on`
  predicate back in — EXTRACT synthesizes them for every event, so losing them would
  silently drop every event's date bridge
- `_restore_prior` re-imposes every entry of a prior schema over the model's output
  ("extend, do not modify"), which is what keeps node_ids stable across rebuilds
- MAX_TYPES / MAX_PREDICATES cap the vocabulary regardless of what came back

The cap is enforced by refusing an over-long list, not by slicing one. Slicing was
silent: a run that committed 34 predicates got 30, discovered the loss only through
`unmappedRawPredicates`, and paid for the whole design turn a second time to fix it.
A refusal costs one turn and names exactly what overflowed.

A commit receipt has to be honest for the same reason. `unmappedRawTypes` and
`unmappedRawPredicates` carry the oversights only, never a term the model dropped by
name and never the reserved vocabulary, both of which a correct design leaves out on
purpose. Reporting those as unmapped cost one run a second commit that recovered
nothing, which is the slicing failure again wearing a different hat.

The raw vocabulary itself is read, not aggregated. All the tools need the same view
of it and each used to rebuild that view by walking every element file in the build,
which made designing a schema cost more on a large corpus than a small one for no
reason: a thousand pages and ten thousand pages produce roughly the same few hundred
raw strings. `compact_elements` aggregates it once, before the agent is invoked, and
the invocation primes it once before either half runs.
"""

import time

import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage

from shared import artifacts, embeddings, models, vocab
from .common import make_tool, respond
from .context import RunContext

MAX_TYPES = 20
MAX_PREDICATES = 30
CLUSTER_MULTIPLIER = 4  # cluster to ~this many x the final vocabulary, then merge
SCHEMA_FORMAT_VERSION = 1

ROLES = ('identifier', 'observation', 'entity')
RESERVED_TYPE = 'date'
RESERVED_PREDICATE = 'occurred_on'

TYPES_PART = 'consolidate/types.part.json'
PREDICATES_PART = 'consolidate/predicates.part.json'


def _role(value):
    """Coerce a model-returned role to the closed set, defaulting to 'entity'."""
    role = str(value).strip().lower() if value else ''
    return role if role in ROLES else 'entity'


def _cluster(vectors, target):
    """Agglomerative labels (1-based) targeting ~`target` clusters over cosine distance."""
    n = len(vectors)
    if n <= 1:
        return [1] * n
    matrix = np.asarray(vectors, dtype=np.float32)
    linkage_matrix = linkage(matrix, method='average', metric='cosine')
    return fcluster(linkage_matrix, t=min(n, max(1, target)), criterion='maxclust').tolist()


def _group(items, labels):
    clusters = {}
    for item, label in zip(items, labels):
        clusters.setdefault(label, []).append(item)
    return list(clusters.values())


def _restore_prior(canonical, prior_items):
    """Force each prior schema entry back over the model's output (extend, do not modify).

    Returns the number of prior entries the model tried to redefine — a violation counter.
    """
    violations = 0
    for item in prior_items:
        name = item.get('n')
        if not name:
            continue
        current = canonical.get(name)
        if current is not None and any(current.get(k) != item.get(k) for k in item):
            violations += 1
        canonical[name] = dict(item)
    return violations


def _inject_reserved_vocab(canonical_types, type_map, canonical_preds,
                           pred_map, dropped_types, dropped_preds):
    """Deterministically force the pipeline-minted `date` type and `occurred_on` predicate."""
    canonical_types[RESERVED_TYPE] = {
        'n': RESERVED_TYPE,
        'label': 'Date',
        'def': 'A calendar date on which an observation occurred.',
        'role': 'identifier',
        'semantic': True,
    }
    type_map[RESERVED_TYPE] = RESERVED_TYPE
    canonical_preds[RESERVED_PREDICATE] = {
        'n': RESERVED_PREDICATE,
        'label': 'Occurred On',
        'def': 'Links an observation to the date on which it occurred.',
        'dom': [],
        'rng': [RESERVED_TYPE],
    }
    pred_map[RESERVED_PREDICATE] = [RESERVED_PREDICATE, False]
    dropped_types[:] = [d for d in dropped_types if d.get('n') != RESERVED_TYPE]
    dropped_preds[:] = [d for d in dropped_preds if d.get('n') != RESERVED_PREDICATE]


def _record_unplaced(raw_items, placed, dropped, reason, reserved):
    """File every raw item the design neither placed nor dropped, and return just those.

    What comes back is what the commit receipt reports as unmapped, and it is narrower
    than "everything absent from the map" on purpose. An item the model dropped by name
    is a decision, not an oversight, and the reserved term is injected by the merge
    whatever the model does with it. Reporting either one back tells a correct commit
    that it lost work, and the run pays for a second design turn to recover nothing.
    """
    known = {d['n'] for d in dropped}
    unplaced = []
    for raw in raw_items:
        if raw in placed or raw in known or raw == reserved:
            continue
        dropped.append({'n': raw, 'why': reason})
        unplaced.append(raw)
    return unplaced


def _prior_schema(ctx: RunContext):
    uri = artifacts.resolve(ctx.run_prefix, 'input/prior_schema.json')
    return artifacts.read_json(uri) if artifacts.exists(uri) else None


def _collect_types(raw_types, stats):
    """Fold the subagent's canonical types into the schema, recording split conflicts."""
    canonical, type_map = {}, {}
    for t in raw_types:
        name = str(t.get('n', '')).strip()
        if not name:
            continue
        canonical.setdefault(name, {
            'n': name,
            'label': (str(t.get('label')).strip() if t.get('label') else name),
            'def': t.get('def', ''),
            'role': _role(t.get('role')),
            'semantic': bool(t.get('semantic', True)),
        })
        for raw in t.get('absorbs', []):
            key = str(raw).strip().lower()
            if not key:
                continue
            if key in type_map and type_map[key] != name:
                stats['split_conflict'] += 1
                continue
            type_map[key] = name
    return canonical, type_map


def _collect_predicates(raw_preds):
    """Fold the subagent's canonical predicates in, recording absorbed and flipped raws."""
    canonical, pred_map = {}, {}
    for p in raw_preds:
        name = str(p.get('n', '')).strip()
        if not name:
            continue
        canonical.setdefault(name, {
            'n': name,
            'label': (str(p.get('label')).strip() if p.get('label') else name),
            'def': p.get('def', ''),
            'dom': p.get('dom', []),
            'rng': p.get('rng', []),
        })
        for raw in p.get('absorbs', []):
            key = str(raw).strip().lower()
            if key:
                pred_map[key] = [name, False]
        for raw in p.get('flip', []):
            key = str(raw).strip().lower()
            if key:
                pred_map[key] = [name, True]
    return canonical, pred_map


def _over_cap(items, cap, noun):
    """A refusal payload when a committed list is longer than the cap, or None.

    Returned instead of slicing. A slice is invisible to the model until it reads the
    unmapped list back, and by then the only way to recover the dropped entries is to
    design the whole vocabulary again.
    """
    if len(items) <= cap:
        return None
    overflow = [str(i.get('n', '')).strip() for i in items[cap:] if isinstance(i, dict)]
    return respond({
        'committed': False,
        'error': (
            f"{len(items)} {noun} were submitted but the cap is {cap}. Nothing was "
            f"written. Fold the surplus into the {noun} you are keeping, or drop them "
            'explicitly, and commit once more.'
        ),
        'cap': cap,
        'submitted': len(items),
        'overflow': overflow,
    })


def _dropped(raw_list) -> list:
    return [
        {'n': str(d.get('n', '')).strip(), 'why': d.get('why', '')}
        for d in (raw_list or [])
        if isinstance(d, dict)
    ]


def _resolve_type_refs(names, type_map, canonical_types) -> list:
    """Map a predicate's raw domain/range strings onto committed canonical type names.

    The predicate run names these while the type run is still deciding, so they arrive
    raw. A name that is already canonical passes through, which is what lets a restored
    prior predicate keep the domain it was written with. Anything that resolves to
    nothing is dropped rather than left dangling at a type that does not exist.
    """
    resolved = []
    for name in names or []:
        key = str(name).strip()
        canonical = type_map.get(key.lower()) or (key if key in canonical_types else None)
        if canonical and canonical not in resolved:
            resolved.append(canonical)
    return resolved


def merge_consolidation(ctx: RunContext) -> dict:
    """Fold both halves into `schema.json` and `maps.json`. Raises if either is missing.

    This is not a tool. Nothing the model does writes the two artifacts the invocation
    checks for, so a half that never committed cannot leave a build looking consolidated.
    """
    types_uri = artifacts.resolve(ctx.run_prefix, TYPES_PART)
    preds_uri = artifacts.resolve(ctx.run_prefix, PREDICATES_PART)
    missing = [name for name, uri in ((TYPES_PART, types_uri), (PREDICATES_PART, preds_uri))
               if not artifacts.exists(uri)]
    if missing:
        raise ValueError(f"cannot merge: {', '.join(missing)} was never committed")

    types_part = artifacts.read_json(types_uri)
    preds_part = artifacts.read_json(preds_uri)

    canonical_types = dict(types_part['types'])
    type_map = dict(types_part['type_map'])
    dropped_types = list(types_part['dropped'])
    canonical_preds = dict(preds_part['predicates'])
    pred_map = dict(preds_part['pred_map'])
    dropped_preds = list(preds_part['dropped'])

    for predicate in canonical_preds.values():
        predicate['dom'] = _resolve_type_refs(predicate.get('dom'), type_map, canonical_types)
        predicate['rng'] = _resolve_type_refs(predicate.get('rng'), type_map, canonical_types)

    _inject_reserved_vocab(canonical_types, type_map, canonical_preds,
                           pred_map, dropped_types, dropped_preds)

    raw = vocab.read(ctx.run_prefix) if ctx.vocab is None else ctx.vocab
    type_items = [t['raw'] for t in raw['types']]
    pred_items = [p['raw'] for p in raw['predicates']]
    prior_schema = _prior_schema(ctx)

    identifiers = sorted(n for n, t in canonical_types.items() if t['role'] == 'identifier')
    type_attrs = {
        n: {'label': t['label'], 'role': t['role'], 'semantic': t['semantic']}
        for n, t in canonical_types.items()
    }

    schema = {
        'schema_version': SCHEMA_FORMAT_VERSION,
        'revision': (prior_schema.get('revision', 0) + 1) if prior_schema else 1,
        'build_id': ctx.job_id,
        'created_at': int(time.time()),
        'parent_schema_uri': prior_schema.get('self_uri', '') if prior_schema else '',
        'types': list(canonical_types.values()),
        'predicates': list(canonical_preds.values()),
    }
    artifacts.write_json(artifacts.resolve(ctx.run_prefix, 'consolidate/schema.json'), schema)
    artifacts.write_json(artifacts.resolve(ctx.run_prefix, 'consolidate/maps.json'), {
        'type_map': type_map,
        'pred_map': pred_map,
        'identifier_types': identifiers,
        'type_attrs': type_attrs,
        'dropped_types': dropped_types,
        'dropped_predicates': dropped_preds,
        'counts': {
            'types_dropped': len(dropped_types),
            'predicates_dropped': len(dropped_preds),
            'types_raw': len(type_items),
            'types_canonical': len(canonical_types),
            'predicates_raw': len(pred_items),
            'predicates_canonical': len(canonical_preds),
            'types_split_conflict': types_part.get('split_conflict', 0),
            'types_prior_violation': types_part.get('prior_violation', 0),
            'predicates_prior_violation': preds_part.get('prior_violation', 0),
            'batches_failed': 0,
        },
    })

    return {
        'types': len(canonical_types),
        'predicates': len(canonical_preds),
        'identifierTypes': identifiers,
    }


def prime_vocab(ctx: RunContext):
    """Read the raw vocabulary onto the context once, memoized.

    The invocation calls this before either half starts, so two concurrent runs share
    one read rather than racing through the memo and fetching the same object twice.
    """
    if ctx.vocab is None:
        ctx.vocab = vocab.read(ctx.run_prefix)
    return ctx.vocab


def _fail_build_tool(ctx: RunContext):
    async def fail_build(args: dict) -> dict:
        # Recorded on the context, not written to the row. The invocation decides how
        # the stage ended by checking whether the schema artifacts exist, so this is
        # the model's stated reason rather than the model's verdict.
        ctx.failure_reason = str(args['reason']).strip() or (
            'the schema could not be consolidated'
        )
        return respond({'status': models.AGENT_FAILED, 'error': ctx.failure_reason})

    return make_tool(
        'fail_build',
        (
            'Stop the build with a stated reason. Only for a failure you cannot work '
            'around at all, such as no raw vocabulary existing to consolidate. A schema '
            'that is merely smaller than you hoped is not a failure.'
        ),
        {'reason': str},
        fail_build,
    )


def types_tools(ctx: RunContext) -> list:
    async def collect_raw_types(_args: dict) -> dict:
        raw = prime_vocab(ctx)
        prior = _prior_schema(ctx)
        return respond({
            'types': [
                {'raw': t['raw'], 'pages': t['pages'], 'examples': t['examples'][:5]}
                for t in raw['types']
            ],
            'maxTypes': MAX_TYPES,
            'priorTypes': (prior.get('types', []) if prior else None),
        })

    async def cluster_raw_types(_args: dict) -> dict:
        raw = prime_vocab(ctx)
        items = [t['raw'] for t in raw['types']]
        texts = [f"{t['raw']}: {', '.join(t['examples'])}" for t in raw['types']]
        vectors = embeddings.embed_texts(texts) if texts else []
        return respond({
            'note': (
                'These clusters are SUGGESTIONS from cosine similarity only. Different '
                'identifier kinds and different document kinds all cluster together and '
                'must not be merged. You decide every merge.'
            ),
            'typeClusters': _group(items, _cluster(vectors, CLUSTER_MULTIPLIER * MAX_TYPES)),
        })

    async def commit_types(args: dict) -> dict:
        raw_types = args.get('types') or []
        refusal = _over_cap(raw_types, MAX_TYPES, 'types')
        if refusal is not None:
            return refusal

        dropped_types = _dropped(args.get('dropped_types'))
        raw = prime_vocab(ctx)
        type_items = [t['raw'] for t in raw['types']]
        prior_schema = _prior_schema(ctx)

        stats = {'split_conflict': 0}
        canonical_types, type_map = _collect_types(raw_types, stats)
        unplaced_types = _record_unplaced(type_items, type_map, dropped_types,
                                          'unplaced by type consolidation', RESERVED_TYPE)
        prior_violation = (
            _restore_prior(canonical_types, prior_schema['types']) if prior_schema else 0
        )

        artifacts.write_json(artifacts.resolve(ctx.run_prefix, TYPES_PART), {
            'types': canonical_types,
            'type_map': type_map,
            'dropped': dropped_types,
            'split_conflict': stats['split_conflict'],
            'prior_violation': prior_violation,
        })

        return respond({
            'committed': True,
            'types': len(canonical_types),
            'typesDropped': len(dropped_types),
            'splitConflicts': stats['split_conflict'],
            'priorViolations': prior_violation,
            'unmappedRawTypes': unplaced_types,
        })

    return [
        make_tool(
            'collect_raw_types',
            'Every raw type string the corpus produced, with page counts and example instances, plus any prior schema types to extend.',
            {},
            collect_raw_types,
        ),
        make_tool(
            'cluster_raw_types',
            'Embedding-based clusters over the raw types. Suggestions only, you decide every merge.',
            {},
            cluster_raw_types,
        ),
        make_tool(
            'commit_types',
            (
                'Commit the canonical types. Each type carries n/label/def/role/semantic and the '
                'raw strings it absorbs. The reserved date type is added for you and any prior '
                'schema entry is restored verbatim. Submitting more types than the cap commits '
                'nothing and tells you which ones overflowed. Returns what was committed and '
                'what stayed unmapped.'
            ),
            {
                'type': 'object',
                'properties': {
                    'types': {'type': 'array', 'items': {'type': 'object'}},
                    'dropped_types': {'type': 'array', 'items': {'type': 'object'}},
                },
                'required': ['types'],
            },
            commit_types,
        ),
        _fail_build_tool(ctx),
    ]


def predicates_tools(ctx: RunContext) -> list:
    async def collect_raw_predicates(_args: dict) -> dict:
        raw = prime_vocab(ctx)
        prior = _prior_schema(ctx)
        return respond({
            'predicates': [
                {'raw': p['raw'], 'count': p['count'],
                 'commonestPair': p['commonestPair'], 'examples': p['examples'][:3]}
                for p in raw['predicates']
            ],
            # The raw type strings, so a domain and a range can be named against the
            # vocabulary that actually exists. They are raw on purpose: the canonical
            # names are being decided by the other run right now, and the merge maps
            # whatever is stated here through that run's type map.
            'rawTypes': [t['raw'] for t in raw['types']],
            'maxPredicates': MAX_PREDICATES,
            'priorPredicates': (prior.get('predicates', []) if prior else None),
        })

    async def cluster_raw_predicates(_args: dict) -> dict:
        raw = prime_vocab(ctx)
        items = [p['raw'] for p in raw['predicates']]
        texts = [f"{p['raw']}: " + ' ; '.join(p['examples']) for p in raw['predicates']]
        vectors = embeddings.embed_texts(texts) if texts else []
        return respond({
            'note': (
                'These clusters are SUGGESTIONS from cosine similarity only. Inverses and '
                'opposites both cluster together and mean opposite things, so they must '
                'not be merged blindly. You decide every merge.'
            ),
            'predicateClusters': _group(
                items, _cluster(vectors, CLUSTER_MULTIPLIER * MAX_PREDICATES)
            ),
        })

    async def commit_predicates(args: dict) -> dict:
        raw_preds = args.get('predicates') or []
        refusal = _over_cap(raw_preds, MAX_PREDICATES, 'predicates')
        if refusal is not None:
            return refusal

        dropped_preds = _dropped(args.get('dropped_predicates'))
        raw = prime_vocab(ctx)
        pred_items = [p['raw'] for p in raw['predicates']]
        prior_schema = _prior_schema(ctx)

        canonical_preds, pred_map = _collect_predicates(raw_preds)
        unplaced_preds = _record_unplaced(pred_items, pred_map, dropped_preds,
                                          'unplaced by predicate consolidation',
                                          RESERVED_PREDICATE)
        prior_violation = (
            _restore_prior(canonical_preds, prior_schema['predicates']) if prior_schema else 0
        )

        artifacts.write_json(artifacts.resolve(ctx.run_prefix, PREDICATES_PART), {
            'predicates': canonical_preds,
            'pred_map': pred_map,
            'dropped': dropped_preds,
            'prior_violation': prior_violation,
        })

        return respond({
            'committed': True,
            'predicates': len(canonical_preds),
            'predicatesDropped': len(dropped_preds),
            'priorViolations': prior_violation,
            'unmappedRawPredicates': unplaced_preds,
        })

    return [
        make_tool(
            'collect_raw_predicates',
            'Every raw predicate string the corpus produced, with counts, its commonest type pair and example instances, plus the raw type vocabulary and any prior schema predicates to extend.',
            {},
            collect_raw_predicates,
        ),
        make_tool(
            'cluster_raw_predicates',
            'Embedding-based clusters over the raw predicates. Suggestions only, you decide every merge.',
            {},
            cluster_raw_predicates,
        ),
        make_tool(
            'commit_predicates',
            (
                'Commit the canonical predicates. Each predicate carries n/label/def/dom/rng plus '
                'the raw strings it absorbs and the ones it flips. State dom and rng as RAW type '
                'strings: they are resolved to canonical types for you. The reserved occurred_on '
                'predicate is added for you and any prior schema entry is restored verbatim. '
                'Submitting more predicates than the cap commits nothing and tells you which ones '
                'overflowed. Returns what was committed and what stayed unmapped.'
            ),
            {
                'type': 'object',
                'properties': {
                    'predicates': {'type': 'array', 'items': {'type': 'object'}},
                    'dropped_predicates': {'type': 'array', 'items': {'type': 'object'}},
                },
                'required': ['predicates'],
            },
            commit_predicates,
        ),
        _fail_build_tool(ctx),
    ]
