"""Page-and-chunk segmentation for the converted markdown.

The pipeline has two units of text. A *page* is the LLM extraction unit — the
markdown converter emits one file per PDF page (`<base>-page-<n>.md`), and flat
sources (images, plain text, transcripts) arrive as a single file that is split
structurally into comparable pages. A *chunk* is the retrieval leaf: it partitions
its parent page's text and records exact `char_start`/`char_end` offsets into that
page, so an extracted item's char offset resolves to the chunk that contains it.
"""

import re

CHUNK_TOKENS = 350
CHARS_PER_TOKEN = 4
CHUNK_CHARS = CHUNK_TOKENS * CHARS_PER_TOKEN  # token target approximated by characters

PAGE_TARGET_CHARS = 6000  # structural page size for sources with no native pages
MAX_PAGE_CHARS = 12000    # cap so a single page never blows the per-page LLM budget

_PAGE_RE = re.compile(r"-page-(\d+)\.md$", re.IGNORECASE)
_HEADING_SPLIT = re.compile(r"(?=^#{1,6}\s)", re.MULTILINE)
_PARA_SPLIT = re.compile(r"\n\s*\n")


def page_from_key(key: str):
    """Extract the 1-based page number from a converter output key, or None."""
    match = _PAGE_RE.search(key)
    return int(match.group(1)) if match else None


def _boundary(text: str, target: int, floor: int) -> int:
    """Find the nicest cut point at or before `target`, not earlier than `floor`."""
    window = text[floor:target]
    for sep in ("\n\n", "\n", ". ", " "):
        idx = window.rfind(sep)
        if idx != -1 and floor + idx > floor:
            return floor + idx + len(sep)
    return target


def enforce_page_size(text: str):
    """Hard-split a page that exceeds MAX_PAGE_CHARS into size-bounded sub-pages."""
    text = text or ""
    if len(text) <= MAX_PAGE_CHARS:
        return [text] if text.strip() else []
    pieces, start, length = [], 0, len(text)
    while start < length:
        end = min(start + MAX_PAGE_CHARS, length)
        if end < length:
            end = _boundary(text, end, start + MAX_PAGE_CHARS // 2)
        piece = text[start:end]
        if piece.strip():
            pieces.append(piece)
        start = end
    return pieces


def split_pages(text: str, target: int = PAGE_TARGET_CHARS):
    """Structurally split a flat document into pages (headings first, then paragraphs)."""
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= target:
        return enforce_page_size(text)

    parts = _HEADING_SPLIT.split(text)
    if len(parts) == 1:
        parts = _PARA_SPLIT.split(text)

    pages, buffer = [], ""
    for part in parts:
        if buffer and len(buffer) + len(part) > target:
            pages.append(buffer.strip())
            buffer = part
        else:
            buffer = (buffer + "\n\n" + part) if buffer else part
    if buffer.strip():
        pages.append(buffer.strip())

    result = []
    for page in pages:
        result.extend(enforce_page_size(page))
    return result


def chunk_page(text: str, target: int = CHUNK_CHARS):
    """Partition a page into contiguous chunks: [{text, char_start, char_end}].

    Chunks tile the page with no overlap, so every character offset falls in exactly
    one chunk — that is what lets an extracted item's offset map to its chunk.
    """
    text = text or ""
    if not text.strip():
        return []
    chunks, start, length = [], 0, len(text)
    while start < length:
        end = min(start + target, length)
        if end < length:
            end = _boundary(text, end, start + target // 2)
        chunks.append({"text": text[start:end], "char_start": start, "char_end": end})
        start = end
    return chunks
