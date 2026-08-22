"""Streaming tag parser (state machine) for classifying agent output.

Processes streamed text chunks character-by-character, detecting <message> and <act>
tags to classify content into structured events: reasoning, message, or action.
"""

from enum import Enum
from typing import Generator

# Tags recognized by the parser (all lowercase for matching)
_OPEN_TAGS = {"<message>": "message", "<act>": "action"}
_CLOSE_TAGS = {"</message>": "message", "</act>": "action"}

# Max buffer length before flushing as literal text.
# Longest known tag is "</message>" at 10 chars; 12 gives a small margin.
_MAX_TAG_BUFFER = 12


class _State(Enum):
    REASONING = "reasoning"
    MESSAGE = "message"
    ACTION = "action"


class StreamParser:
    """Character-level state machine that classifies streamed text into typed events.

    Usage:
        parser = StreamParser()
        for chunk in stream:
            for event in parser.feed(chunk):
                yield event    # {"type": "reasoning"|"message"|"action", "content": "..."}
        for event in parser.flush():
            yield event        # drain remaining buffer at stream end
    """

    def __init__(self) -> None:
        self._state = _State.REASONING
        self._content_buf = ""  # accumulated content in current state
        self._tag_buf = ""  # partial tag being scanned (original case)
        self._in_tag = False  # True while buffering a potential tag

    def feed(self, text: str) -> Generator[dict, None, None]:
        """Process a text chunk, yielding structured events as tags are resolved."""
        for char in text:
            if self._in_tag:
                self._tag_buf += char
                if char == ">":
                    yield from self._resolve_tag()
                elif len(self._tag_buf) > _MAX_TAG_BUFFER:
                    # Too long to be a known tag — flush as literal text
                    self._content_buf += self._tag_buf
                    self._tag_buf = ""
                    self._in_tag = False
            elif char == "<":
                self._tag_buf = "<"
                self._in_tag = True
            else:
                self._content_buf += char

        # Stream message content incrementally at chunk boundaries
        if self._content_buf and self._state == _State.MESSAGE:
            yield {"type": "message", "content": self._content_buf}
            self._content_buf = ""

    def flush(self) -> Generator[dict, None, None]:
        """Drain remaining buffers. Call at stream end or before non-text events.

        Preserves current state so the parser can resume after tool interruptions.
        """
        if self._tag_buf:
            self._content_buf += self._tag_buf
            self._tag_buf = ""
            self._in_tag = False

        if self._content_buf:
            yield {"type": self._state.value, "content": self._content_buf}
            self._content_buf = ""

    def _resolve_tag(self) -> Generator[dict, None, None]:
        """Resolve a completed tag buffer: transition state or flush as literal text."""
        original = self._tag_buf
        tag_lower = original.lower()
        self._tag_buf = ""
        self._in_tag = False

        if tag_lower in _OPEN_TAGS:
            # Emit content before the tag, then transition to new state
            yield from self._emit_content()
            self._state = _State(_OPEN_TAGS[tag_lower])
        elif tag_lower in _CLOSE_TAGS:
            # Emit content inside the tag, then return to reasoning
            yield from self._emit_content()
            self._state = _State.REASONING
        else:
            # Not a known tag — treat original text as literal content
            self._content_buf += original

    def _emit_content(self) -> Generator[dict, None, None]:
        """Emit accumulated content buffer as an event in the current state."""
        if self._content_buf:
            yield {"type": self._state.value, "content": self._content_buf}
            self._content_buf = ""
