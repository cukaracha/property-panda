"""Evidence-anchor matching — locate a verbatim quote in page text.

Every extracted item carries a short verbatim quote (`ev`) copied from the page.
Matching that quote back to the page yields a character offset, which yields the
containing chunk, which yields provenance. An item whose anchor does not match the
page was hallucinated and is discarded. Matching is exact first, then normalized
(collapse whitespace, casefold, strip punctuation) so trivial copy drift still
locates, while a genuinely invented quote still fails.
"""


def _normalized_with_map(text: str):
    """Return (normalized_text, index_map) where index_map[i] is the raw offset of
    normalized char i. Normalization: casefold, drop punctuation, collapse runs of
    whitespace to a single space."""
    norm_chars, index_map, prev_space = [], [], False
    for raw_idx, ch in enumerate(text):
        c = ch.casefold()
        if c.isspace():
            if prev_space:
                continue
            norm_chars.append(" ")
            index_map.append(raw_idx)
            prev_space = True
        elif c.isalnum():
            norm_chars.append(c)
            index_map.append(raw_idx)
            prev_space = False
        # punctuation: dropped
    return "".join(norm_chars), index_map


def _normalized(text: str) -> str:
    norm, _ = _normalized_with_map(text)
    return norm


def find_offset(page_text: str, anchor: str) -> int:
    """Char offset of `anchor` in `page_text` (exact, then normalized), or -1."""
    if not anchor:
        return -1
    idx = page_text.find(anchor)
    if idx != -1:
        return idx

    norm_page, index_map = _normalized_with_map(page_text)
    norm_anchor = _normalized(anchor).strip()
    if not norm_anchor:
        return -1
    pos = norm_page.find(norm_anchor)
    if pos == -1:
        return -1
    return index_map[pos]


def chunk_for_offset(offset: int, chunks) -> str:
    """chunk_id of the chunk whose [char_start, char_end) contains `offset`.

    `chunks` is the page's chunk boundary list ({chunkId, charStart, charEnd}).
    Offsets past the last boundary (normalization drift) clamp to the last chunk.
    """
    if not chunks:
        return ""
    for chunk in chunks:
        if chunk["charStart"] <= offset < chunk["charEnd"]:
            return chunk["chunkId"]
    return chunks[-1]["chunkId"]
