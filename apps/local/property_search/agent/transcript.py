"""The stored conversation for one chat session.

The cloud chat kept conversations in AgentCore Memory, keyed by a conversation id the
browser held in localStorage. The browser still holds that id; the turns now land in
`.data/chat/{sessionId}.json` instead, so a reload replays the same thread and the
assistant is fed words it actually said.

Two things are stored per assistant turn: the prose, and the workflow steps behind it.
The thinking card is most of what a past turn shows, and a reasoning trace cannot be
reconstructed from prose after the fact, so it is written down rather than recovered.

Proposed actions are deliberately NOT stored. An action card is live UI -- a pending
one renders Approve and Reject, and its callback still fires -- so replaying one a day
later would offer to hide a property the user already decided about. The server never
learns the outcome (approval is resolved entirely in the browser), so the honest
choice is to leave the buttons out of the replay rather than show a stale one.
"""

import json
import os
import re
import threading
import uuid
from datetime import datetime, timezone

from store import DATA_DIR

CHAT_DIR = os.path.join(DATA_DIR, "chat")

# How many prior turns are replayed to the agent. A conversation can outlive any
# number of reloads, so this bounds what a very long one costs before the agent has
# read a single word of the current question.
HISTORY_TURNS = 24

# Session ids come from the browser and land in a filename, so anything that is not
# plainly a name is stripped rather than trusted.
_UNSAFE = re.compile(r"[^A-Za-z0-9_-]")

_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sanitize_id(session_id: str) -> str:
    """Reduce a session id to something that can only ever name one file here."""
    return _UNSAFE.sub("", session_id or "")[:64]


def _path(session_id: str) -> str:
    return os.path.join(CHAT_DIR, f"{sanitize_id(session_id)}.json")


def load(session_id: str) -> list:
    """Every stored turn of one conversation, oldest first.

    An unknown id is an empty conversation rather than an error: the browser mints a
    session id before its first turn, so asking for one that has never been written
    is the normal case on a fresh panel.
    """
    if not sanitize_id(session_id):
        return []
    with _lock:
        try:
            with open(_path(session_id)) as f:
                data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return []
    messages = data.get("messages") if isinstance(data, dict) else None
    return messages if isinstance(messages, list) else []


def append(session_id: str, role: str, content: str, workflow: list = None):
    """Add one turn to a conversation, creating it if this is the first."""
    if not sanitize_id(session_id):
        return

    turn = {"role": role, "content": content, "timestamp": _now()}
    if workflow:
        turn["workflow"] = workflow

    with _lock:
        path = _path(session_id)
        try:
            with open(path) as f:
                data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            data = {}
        messages = data.get("messages")
        data["messages"] = (messages if isinstance(messages, list) else []) + [turn]

        os.makedirs(CHAT_DIR, exist_ok=True)
        temp_path = f"{path}.tmp"
        with open(temp_path, "w") as f:
            json.dump(data, f)
        os.replace(temp_path, path)


def recent_turns(session_id: str, limit: int = HISTORY_TURNS) -> list:
    """The tail of a conversation, as the (role, content) pairs the prompt replays."""
    turns = [turn for turn in load(session_id) if (turn.get("content") or "").strip()]
    return turns[-limit:]


class TurnRecorder:
    """Rebuilds what the browser rendered, so a replay matches what the user saw.

    The accumulation rules here mirror `useChatEngine` deliberately: prose arrives in
    fragments and is concatenated, consecutive reasoning fragments merge into one
    step, and a blank line is inserted when prose resumes after a tool call. Storing
    the raw event list instead would replay as a wall of run-together text.
    """

    def __init__(self) -> None:
        self._parts: list = []
        self._steps: list = []
        self._last_type = None

    @staticmethod
    def _step(kind: str, content: str) -> dict:
        return {
            "id": str(uuid.uuid4()),
            "type": kind,
            "content": content,
            "timestamp": _now(),
        }

    def consume(self, event: dict):
        kind = event.get("type")
        content = event.get("content") or ""

        if kind == "message":
            if self._last_type not in (None, "message"):
                self._parts.append("\n\n")
            self._parts.append(content)
        elif kind == "reasoning":
            if self._steps and self._steps[-1]["type"] == "reasoning":
                self._steps[-1]["content"] += content
            else:
                self._steps.append(self._step("reasoning", content))
        elif kind in ("tool", "error"):
            self._steps.append(self._step(kind, content))

        # `status` is bookkeeping, not content, and letting it set this would put a
        # spurious blank line in front of any prose that followed it.
        if kind != "status":
            self._last_type = kind

    @property
    def content(self) -> str:
        return "".join(self._parts).strip()

    @property
    def steps(self) -> list:
        return self._steps
