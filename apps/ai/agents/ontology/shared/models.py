"""Shared vocabulary for the ontology pipeline.

The stages exchange data as plain JSON under the run prefix (see artifacts.py),
so this module holds the small, stable pieces every stage agrees on: the ordered
coarse stage names surfaced to the frontend stepper, the terminal job statuses,
who is allowed to read a build, and a slug helper. Keeping these in one place is what
stops the map/reduce stages from drifting apart on naming.
"""

import re
import unicodedata

# Ordered coarse stages, surfaced to the frontend stepper via the jobs table. Every
# one of them is now written by a control Lambda at its own boundary: the agent holds
# no tool that can set a stage, because the state machine decides where a build is.
STAGES = ["CARRY_FORWARD", "CONVERT", "SEGMENT", "EXTRACT", "CONSOLIDATE",
          "CANONICALIZE", "EMIT"]

# How the agent's stage ended, written by the agent and polled by the state machine.
# Separate from `status` on purpose: it is internal coordination between two halves
# of the pipeline, not one of the build's two user-visible completion signals.
AGENT_CONSOLIDATED = "consolidated"
AGENT_FAILED = "failed"

# Terminal job statuses.
STATUS_PROCESSING = "processing"
STATUS_SUCCEEDED = "succeeded"
STATUS_FAILED = "failed"
STATUS_PARTIAL = "partial"

# Stopped after conversion, waiting for the user to say what to do about the documents
# that could not be converted. Deliberately not terminal: the build has not finished and
# whichever answer arrives overwrites this, either back to processing or to failed.
STATUS_AWAITING_REVIEW = "awaitingReview"

# A job that has reached one of these is finished; nothing may overwrite it.
TERMINAL_STATUSES = (STATUS_SUCCEEDED, STATUS_FAILED, STATUS_PARTIAL)

# Whether the build's pages are searchable. Tracked separately from `status`
# because the graph and the page index are built by two concurrent branches: an
# ontology can be complete and not yet searchable, and hydration can fail without
# invalidating the graph.
INDEX_PENDING = "pending"
INDEX_READY = "ready"
INDEX_FAILED = "failed"

# Who may read a build. A private build carries no `visibility` at all, which is what
# keeps the by_visibility index sparse, so "published" is the only value this ever
# takes and its absence is the private case.
VISIBILITY_PUBLISHED = "published"


def owner_of(item: dict) -> str:
    """The sub whose prefix a build's artifacts live under.

    Nothing moves when an ontology is published. Its pages, its elements and its
    vectors keep the owner's sub in their keys and their metadata, so every read path
    has to resolve the layout from the row rather than from whoever is asking.
    """
    return (item or {}).get("userId") or ""


def is_published(item: dict) -> bool:
    return (item or {}).get("visibility") == VISIBILITY_PUBLISHED


def can_read(item: dict, user_sub: str) -> bool:
    """Its owner, or anyone at all once it is published."""
    return bool(item) and (owner_of(item) == user_sub or is_published(item))


def slugify(text: str, max_len: int = 60) -> str:
    """Lowercase ASCII slug for stable ids/labels."""
    normalized = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    return (slug[:max_len].rstrip("-")) or "unknown"
