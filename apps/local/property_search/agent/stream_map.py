"""Turn the SDK message stream into the events the browser already renders.

The frontend has always spoken one shape for every agent in this app -- `{type,
content}` with type in reasoning|message|tool|action|status|error, described in
`types/chatbot.ts` -- so this maps onto that rather than inventing a second protocol
for one panel.

Text comes out of here as `text`, not `message`, because prose and proposed actions
share one stream: the `<act>` blocks are separated downstream by `act_parser`, and it
is that which produces the final `message` and `action` events. Everything else is
already in the shape the browser reads.

Prose and reasoning are emitted as fragments, so an answer appears as it is written
instead of landing whole a minute later. The finished text block is not sent again on
top of its fragments, which would print the whole answer twice -- but it IS sent when
no fragments arrived at all, so a build without partial messages still says something
rather than nothing.
"""

from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ResultMessage,
    StreamEvent,
    TextBlock,
    ToolUseBlock,
)

# The argument worth naming in a tool row, by tool. Everything else falls back to the
# first short scalar it was given, which for a one-argument tool is the right answer
# and for the rest is at least a hint of what it was asked.
_INPUT_HIGHLIGHTS: dict = {
    'WebSearch': ('query',),
    'WebFetch': ('url',),
}

# Long enough for a search query or a URL, short enough that a tool row stays one line.
_MAX_ARG = 120


def bare_tool_name(name: str) -> str:
    """Strip any `mcp__<server>__` prefix. A built-in is returned unchanged."""
    return name.split('__')[-1]


class StreamMapper:
    def __init__(self) -> None:
        self._seen_tool_ids: set = set()
        self._saw_text_delta = False

    def consume(self, message: Any) -> list:
        if isinstance(message, StreamEvent):
            return self._consume_partial(message)
        if isinstance(message, AssistantMessage):
            return self._consume_assistant(message)
        if isinstance(message, ResultMessage):
            return [self._consume_result(message)]
        return []

    def _summarize_input(self, name: str, tool_input: dict) -> str:
        highlights = _INPUT_HIGHLIGHTS.get(name)
        if highlights:
            return ' '.join(str(tool_input[key]) for key in highlights if key in tool_input)

        for value in tool_input.values():
            if isinstance(value, (str, int, float)) and len(str(value)) <= _MAX_ARG:
                return str(value)
        return ''

    def _consume_partial(self, message: StreamEvent) -> list:
        """The answer and the reasoning behind it, in fragments, as they are written.

        `signature_delta` and `input_json_delta` fall through: a signature is not
        text, and a tool's arguments are reported once its block completes.
        """
        event = message.event or {}
        if event.get('type') != 'content_block_delta':
            return []
        delta = event.get('delta') or {}
        kind = delta.get('type')

        if kind == 'text_delta':
            text = delta.get('text') or ''
            if not text:
                return []
            self._saw_text_delta = True
            return [{'type': 'text', 'content': text}]

        if kind == 'thinking_delta':
            thinking = delta.get('thinking') or ''
            return [{'type': 'reasoning', 'content': thinking}] if thinking else []
        return []

    def _consume_assistant(self, message: AssistantMessage) -> list:
        events = []
        for block in message.content:
            if isinstance(block, TextBlock):
                # Only as a fallback -- see the module docstring.
                if self._saw_text_delta:
                    continue
                text = block.text.strip()
                if text:
                    events.append({'type': 'text', 'content': text})
            elif isinstance(block, ToolUseBlock):
                if block.id in self._seen_tool_ids:
                    continue
                self._seen_tool_ids.add(block.id)
                name = bare_tool_name(block.name)
                summary = self._summarize_input(name, block.input or {})
                # `name(args)` is the shape `parseTool` in ReasoningCard splits on, so
                # the row shows a named tool with its argument beside it.
                content = f"{name}({summary})" if summary else name
                events.append({'type': 'tool', 'content': content[:300]})
        return events

    def _consume_result(self, message: ResultMessage) -> dict:
        if not message.is_error:
            return {'type': 'status', 'content': 'complete'}
        # `subtype` is a category, not a sentence, and on a failed turn it can still
        # read 'success' -- the CLI reports how the run ended separately from whether
        # it worked. `result` carries the actual reason when there is one.
        reason = (message.result or '').strip()
        if not reason or reason == message.subtype:
            reason = 'The assistant could not finish this turn.'
        return {'type': 'error', 'content': reason[:1000]}
