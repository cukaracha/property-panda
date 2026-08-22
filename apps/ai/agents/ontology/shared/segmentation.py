"""Turn the converted markdown into pages and chunks.

Wholly deterministic, which is why it runs in the state machine rather than as an
agent role: there is nothing here for a model to decide, and the two-level text
model the rest of the build depends on must not be able to drift.

A *page* is the extraction unit — the markdown converter emits one file per PDF
page (`<base>-page-<n>.md`) and each of those becomes one page, split only if it
exceeds the size cap; a source with no native pages (a transcript, a web capture, a
`.txt`) is split structurally into comparable pages instead. A *chunk* is the
extraction leaf: chunks tile their parent page with exact char offsets and NO
overlap, so an extracted item's offset resolves to exactly one chunk.

That no-overlap property is load-bearing and is NOT the chunking retrieval uses.
The page index windows the same page text with deliberate overlap (see
`control/hydrate_index.py`); the two chunkings are separate on purpose and their
ids never collide.

Two of the build's flat outputs are written here rather than at EMIT. `pages.csv`
and `chunks.csv` are pure restatements of what this function already has in hand at
the moment it cuts each page, so producing them at the end meant reading every page
back out of S3 to recover text that had just been written. They exist from SEGMENT
onward as a result. Nothing surfaces them early: the outputs endpoint presigns what
exists and the frontend only asks for it once a build is terminal.
"""

import hashlib
from concurrent.futures import ThreadPoolExecutor

from . import artifacts, chunking

# One PUT per page is the dominant cost of this stage, and at ten thousand pages a
# serial loop does not finish inside a Lambda. The pages are independent, so they go
# out through a pool sized for S3 the same way the rest of the codebase does, flushed
# in windows so a large corpus never holds every page body in memory at once.
WRITE_WORKERS = 10
WRITE_WINDOW = 200

PAGE_FIELDS = ['page_id', 'doc_id', 'doc_title', 'page_number', 'text']
CHUNK_FIELDS = ['chunk_id', 'page_id', 'doc_id', 'chunk_index', 'char_start', 'char_end',
                'text']


def doc_name(markdown_uri: str) -> str:
    """The converter-derived document key from an output key.

    Opaque by design: bronze objects are named with a uuid, so this is a stable join
    key, not something to show a user. `doc_titles` resolves it to the filename that
    was uploaded.
    """
    filename = markdown_uri.rsplit('/', 1)[-1]
    base = filename[:-3] if filename.endswith('.md') else filename
    for suffix in ('-transcript',):
        if base.endswith(suffix):
            base = base[: -len(suffix)]
    page = chunking.page_from_key(markdown_uri)
    if page is not None:
        base = base.rsplit(f"-page-{page}", 1)[0]
    return base or 'document'


def doc_slug(doc_id: str) -> str:
    """A short, stable id for a document, used as every page id's prefix.

    Page ids are numbered within their own document rather than across the corpus,
    so that adding or removing a document leaves every other document's page ids
    untouched. That is what lets a build carry another build's extracted elements
    forward instead of re-extracting the whole corpus.

    Hashed rather than used raw because `doc_id` is a 36-character uuid and this
    prefix ends up inside every chunk id, every vector key, and the page and chunk
    provenance arrays on every node and edge.
    """
    return "d" + hashlib.sha1((doc_id or "").encode("utf-8")).hexdigest()[:10]


def collect_markdown(markdown_keys: list):
    """Gather (docName, nativePage, markdownUri) for every converted file.

    Ordered by document, then by native page *number* — not by key. The converter
    emits `{doc}-page-N.md`, which sorts `-page-10` before `-page-2` lexically, and
    page ids have to follow the source. The sort is stable, so files with no native
    page keep the order the state machine handed them over in.
    """
    sources = [
        (doc_name(markdown_uri), chunking.page_from_key(markdown_uri), markdown_uri)
        for markdown_uri in markdown_keys
    ]
    return sorted(sources, key=lambda s: (s[0], -1 if s[1] is None else s[1]))


def _pages_for_source(text: str, native_page):
    """Yield (pageText, pageNumber) for one converted file.

    A native page file becomes one page (split only if it exceeds the size cap); a
    flat file is split structurally into comparable pages numbered from 1. An
    oversized native page therefore yields several pages sharing one page NUMBER —
    `page_id` is the only unique page key.
    """
    if native_page is not None:
        for piece in chunking.enforce_page_size(text):
            yield piece, native_page
    else:
        for i, piece in enumerate(chunking.split_pages(text), 1):
            yield piece, i


def _flush_pages(pending: list) -> None:
    """Write a window of pages concurrently, then drop them from memory."""
    if not pending:
        return
    with ThreadPoolExecutor(max_workers=min(len(pending), WRITE_WORKERS)) as pool:
        for _ in pool.map(lambda page: artifacts.write_json(page[0], page[1]), pending):
            pass
    pending.clear()


def segment(run_prefix: str, markdown_keys: list, doc_titles: dict = None) -> list:
    """Write every page under `pages/`, the manifest, and the page and chunk CSVs."""
    titles = doc_titles or {}
    manifest = []
    pending = []
    doc_counters = {}
    pages_csv = artifacts.CsvWriter(artifacts.resolve(run_prefix, 'pages.csv'), PAGE_FIELDS)
    chunks_csv = artifacts.CsvWriter(artifacts.resolve(run_prefix, 'chunks.csv'), CHUNK_FIELDS)
    for doc_id, native_page, markdown_uri in collect_markdown(markdown_keys):
        doc_title = titles.get(doc_id) or doc_id
        source_text = artifacts.read_text(markdown_uri)
        for page_text, page_number in _pages_for_source(source_text, native_page):
            # Counted per document, not across the corpus. A document's markdown is
            # identical whichever build it lands in, and it is always visited as one
            # contiguous run by collect_markdown, so its pages get the same ids in
            # every build that holds it.
            doc_counters[doc_id] = doc_counters.get(doc_id, 0) + 1
            page_id = f"{doc_slug(doc_id)}p{doc_counters[doc_id]:04d}"

            chunk_records, manifest_chunks = [], []
            for idx, chunk in enumerate(chunking.chunk_page(page_text)):
                chunk_id = f"{page_id}c{idx:03d}"
                chunk_record = {
                    'chunk_id': chunk_id,
                    'page_id': page_id,
                    'doc_id': doc_id,
                    'chunk_index': idx,
                    'char_start': chunk['char_start'],
                    'char_end': chunk['char_end'],
                    'text': chunk['text'],
                }
                chunk_records.append(chunk_record)
                chunks_csv.write_row(chunk_record)
                manifest_chunks.append({
                    'chunkId': chunk_id,
                    'charStart': chunk['char_start'],
                    'charEnd': chunk['char_end'],
                })

            page_uri = artifacts.resolve(run_prefix, f"pages/{page_id}.json")
            page_record = {
                'page_id': page_id,
                'doc_id': doc_id,
                'doc_title': doc_title,
                'page_number': page_number,
                'text': page_text,
            }
            pages_csv.write_row(page_record)
            pending.append((page_uri, {**page_record, 'chunks': chunk_records}))
            if len(pending) >= WRITE_WINDOW:
                _flush_pages(pending)
            manifest.append({
                'pageId': page_id,
                'pageUri': page_uri,
                'doc': doc_id,
                'docTitle': doc_title,
                'page': page_number,
                'chunks': manifest_chunks,
            })

    _flush_pages(pending)
    pages_csv.close()
    chunks_csv.close()
    artifacts.write_json(artifacts.resolve(run_prefix, 'pages/manifest.json'), manifest)
    return manifest
