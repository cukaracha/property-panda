"""Pull proposed page actions out of the agent's prose as it streams.

The agent writes an action as an `<act>` block inline in its answer, so prose and
proposals share one stream of text and something has to separate them before either
reaches the browser. This is that: a character-level state machine that emits
`message` for ordinary text and `action` for the JSON inside an `<act>` block.

It is the chat agent's parser with one change. That one defaulted to `reasoning` and
required every user-facing word to be wrapped in `<message>` tags, because its model
had no reasoning of its own to show and untagged prose was the stand-in. This agent
returns real thinking blocks, so the wrapper is gone: text is prose by default and
`<act>` is the only tag left to find.

Prose is emitted at every chunk boundary rather than at the end of a block, which is
what makes an answer appear a word at a time instead of arriving whole.
"""

from enum import Enum
from typing import Generator

_OPEN_TAGS = {"<act>": "action"}
_CLOSE_TAGS = {"</act>": "action"}

# Longest tag is "</act>" at 6 characters; 8 leaves a margin. It also decides how
# much ordinary prose beginning with "<" is held back before being let through as
# literal text, so it is kept tight.
_MAX_TAG_BUFFER = 8


class _State(Enum):
    MESSAGE = "message"
    ACTION = "action"


class ActParser:
    """Classifies streamed text into message and action events.

    Usage:
        parser = ActParser()
        for event in parser.feed(chunk):
            yield event
        for event in parser.flush():
            yield event
    """

    def __init__(self) -> None:
        self._state = _State.MESSAGE
        self._content_buf = ""
        self._tag_buf = ""
        self._in_tag = False

    def feed(self, text: str) -> Generator[dict, None, None]:
        """Process a chunk of text, yielding events as tags resolve."""
        for char in text:
            if self._in_tag:
                self._tag_buf += char
                if char == ">":
                    yield from self._resolve_tag()
                elif len(self._tag_buf) > _MAX_TAG_BUFFER:
                    # Too long to be a tag we know, so it was never one.
                    self._content_buf += self._tag_buf
                    self._tag_buf = ""
                    self._in_tag = False
            elif char == "<":
                self._tag_buf = "<"
                self._in_tag = True
            else:
                self._content_buf += char

        # Prose streams as it arrives. An action does not: its payload is JSON, and
        # half a JSON object is not something the browser can do anything with.
        if self._content_buf and self._state == _State.MESSAGE:
            yield {"type": "message", "content": self._content_buf}
            self._content_buf = ""

    def flush(self) -> Generator[dict, None, None]:
        """Drain what is buffered. Call at stream end, and before any non-text event.

        The state survives the drain, so prose interrupted by a tool call resumes as
        prose rather than restarting mid-answer.
        """
        if self._tag_buf:
            self._content_buf += self._tag_buf
            self._tag_buf = ""
            self._in_tag = False

        if self._content_buf:
            yield {"type": self._state.value, "content": self._content_buf}
            self._content_buf = ""

    def _resolve_tag(self) -> Generator[dict, None, None]:
        """Act on a completed tag, or put it back as literal text if it is not one."""
        original = self._tag_buf
        tag_lower = original.lower()
        self._tag_buf = ""
        self._in_tag = False

        if tag_lower in _OPEN_TAGS:
            yield from self._emit_content()
            self._state = _State(_OPEN_TAGS[tag_lower])
        elif tag_lower in _CLOSE_TAGS:
            yield from self._emit_content()
            self._state = _State.MESSAGE
        else:
            self._content_buf += original

    def _emit_content(self) -> Generator[dict, None, None]:
        if self._content_buf:
            yield {"type": self._state.value, "content": self._content_buf}
            self._content_buf = ""
