"""The Claude subscription token every chat turn runs on.

The cloud version kept one token per user in Secrets Manager, keyed by email, because
several people shared one deployment. Here there is one person on one machine, so
there is one token, in a file under `.data/` beside the scraper's own state.

The token is write-only as far as the browser is concerned: `status()` reports whether
one is saved, when it was saved and its last four characters, and never the value.
That is exactly the shape `ClaudeTokenCard` already reads, so the card works against
this server unchanged.
"""

import json
import os
import threading
from datetime import datetime, timezone

from store import DATA_DIR

TOKEN_FILE = os.path.join(DATA_DIR, "claude_token.json")

_lock = threading.Lock()


def _read() -> dict:
    """Load the token file, treating a missing or corrupt one as no token."""
    try:
        with open(TOKEN_FILE) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _write(data: dict):
    """Write the token file atomically, and only ever readable by this user.

    The mode is set on the temp file rather than after the rename, so the token is
    never on disk world-readable, not even for the instant between the two calls.
    """
    os.makedirs(os.path.dirname(TOKEN_FILE), exist_ok=True)
    temp_path = f"{TOKEN_FILE}.tmp"
    with open(temp_path, "w") as f:
        json.dump(data, f)
    os.chmod(temp_path, 0o600)
    os.replace(temp_path, TOKEN_FILE)


def _status(entry: dict) -> dict:
    token = (entry.get("token") or "").strip()
    if not token:
        return {"configured": False, "updatedAt": None, "maskedSuffix": None}
    return {
        "configured": True,
        "updatedAt": entry.get("updatedAt"),
        "maskedSuffix": token[-4:],
    }


def get_token() -> str:
    """The saved token, or '' when there is none."""
    with _lock:
        return (_read().get("token") or "").strip()


def status() -> dict:
    """What the profile card shows. Never includes the token itself."""
    with _lock:
        return _status(_read())


def put_token(token: str) -> dict:
    """Save a token, or remove the stored one when given an empty string."""
    token = token.strip()
    with _lock:
        if not token:
            try:
                os.remove(TOKEN_FILE)
            except OSError:
                pass
            return _status({})

        entry = {
            "token": token,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
        _write(entry)
        return _status(entry)
