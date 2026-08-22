"""Read the build's verified extraction, once, however many pages it has.

EXTRACT writes one `elements/{page_id}.json` per page, and that granularity is
load-bearing: it is the idempotent write unit a retried batch overwrites, and it is
what lets the sweep tell a page that extracted from a page that did not. What it is
not is a good read unit. Every later stage wants the whole corpus, and walking ten
thousand objects once is expensive enough that doing it five times dominated the back
half of a build.

So the objects stay and a compacted `elements/index.jsonl` is derived from them once,
after extraction settles. Everything downstream streams that single object; the
per-object fallback exists so this module is correct before compaction has run, and
so a lost index is a slower build rather than a broken one.

Nothing here holds the corpus in memory. The fallback is driven in windows rather
than by mapping the whole key list, because a pool that is handed every key at once
buffers every result in order, which is the memory problem it was meant to avoid.
"""

from concurrent.futures import ThreadPoolExecutor

from . import artifacts

INDEX_NAME = 'elements/index.jsonl'

READ_WORKERS = 10
READ_WINDOW = 256


def index_uri(run_prefix: str) -> str:
    return artifacts.resolve(run_prefix, INDEX_NAME)


def element_keys(run_prefix: str) -> list:
    """Every per-page element object under the run prefix."""
    return [
        uri
        for uri in artifacts.list_keys(artifacts.resolve(run_prefix, 'elements/'))
        if uri.endswith('.json')
    ]


def stream_objects(run_prefix: str):
    """Yield every per-page element record, a window of objects at a time."""
    keys = element_keys(run_prefix)
    for start in range(0, len(keys), READ_WINDOW):
        window = keys[start:start + READ_WINDOW]
        with ThreadPoolExecutor(max_workers=min(len(window), READ_WORKERS)) as pool:
            yield from pool.map(artifacts.read_json, window)


def stream(run_prefix: str):
    """Yield every element record, from the compacted index when it exists."""
    uri = index_uri(run_prefix)
    if artifacts.exists(uri):
        yield from artifacts.iter_jsonl(uri)
        return
    yield from stream_objects(run_prefix)


def add_counts(total: dict, element: dict) -> None:
    """Fold one element's extraction counters into a running total, in place."""
    counts = element.get('counts', {})
    for field in total:
        total[field] += int(counts.get(field, 0))
