"""Node keying and normalization for exact-match entity resolution.

Two entities become one node iff they share a key — a pair of the canonical type
plus a normalized string. For identifiers (phone, email, account, ...) the string
is the canonical `norm` produced at extraction, so the same phone written three
ways collapses to one node and bridges the documents it appears in. For everything
else the string is the normalized surface name. No fuzzy matching, no thresholds:
`John A. Smith` and `Johnny Smith` normalize differently and stay two nodes.
"""

import hashlib
import re

_HONORIFICS = {"mr", "mrs", "ms", "miss", "dr", "prof", "sir", "madam", "mx", "rev", "hon"}
_LEGAL_SUFFIXES = {
    "llc", "inc", "incorporated", "corp", "corporation", "ltd", "limited", "co",
    "company", "plc", "gmbh", "llp", "lp", "sa", "ag", "nv", "bv", "pty",
}
_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)


def collapse(text: str) -> str:
    """Casefold, strip punctuation, and collapse whitespace."""
    return " ".join(_PUNCT.sub(" ", (text or "").casefold()).split())


def normalize_name(name: str) -> str:
    """collapse() plus stripping leading honorifics and trailing legal suffixes."""
    tokens = collapse(name).split()
    while tokens and tokens[0] in _HONORIFICS:
        tokens = tokens[1:]
    while tokens and tokens[-1] in _LEGAL_SUFFIXES:
        tokens = tokens[:-1]
    return " ".join(tokens)


def node_key(canonical_type: str, name: str, norm=None, is_identifier: bool = False):
    """The (type, normalized-string) pair two entities must share to be one node."""
    if is_identifier:
        basis = (norm or "").strip() or normalize_name(name)
    else:
        basis = normalize_name(name)
    return (canonical_type, basis)


def node_id(key) -> str:
    """A stable id for a node key (deterministic across runs and stages)."""
    raw = f"{key[0]}|{key[1]}"
    return "n" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def edge_id(source: str, predicate: str, target: str, qualifier: str = "", time: str = "") -> str:
    """A stable id for an edge, hashed from everything that distinguishes it.

    Same construction as node_id, and for the same reason: a rebuild over the same
    corpus has to produce the same id, so a cached edge id or a deep link survives.
    Qualifier and time are part of the hash because they are part of the grouping
    key — an affirmed and a negated claim are two edges, not one.
    """
    raw = f"{source}|{predicate}|{target}|{qualifier}|{time}"
    return "e" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
