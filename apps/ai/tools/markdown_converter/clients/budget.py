"""Remaining-time budget for the converter worker.

worker.py seeds the deadline from the Lambda context so the long internal waits
(ffmpeg transcode, the Transcribe poll) can be capped to the time left before the
function times out. When no deadline is set (e.g. a direct/local call),
remaining_seconds() returns a large default so behavior is unchanged.
"""

import time

_deadline_monotonic = None
_DEFAULT_REMAINING = 24 * 3600  # effectively unbounded when no deadline is set


def set_deadline(seconds_from_now: float) -> None:
    """Seed the budget: this many seconds from now is the hard deadline."""
    global _deadline_monotonic
    _deadline_monotonic = time.monotonic() + max(0.0, seconds_from_now)


def remaining_seconds() -> float:
    """Seconds left before the deadline (a large default when unset)."""
    if _deadline_monotonic is None:
        return _DEFAULT_REMAINING
    return max(0.0, _deadline_monotonic - time.monotonic())
