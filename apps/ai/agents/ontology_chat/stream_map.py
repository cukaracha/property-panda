"""Turn the SDK message stream into the events the browser already renders.

The frontend speaks one shape for every agent in this app — `{type, content}` with
type in reasoning|message|tool|action|status|error (see `types/chatbot.ts`) — so this
maps onto that rather than inventing a second protocol for one panel.

The mapper is pure: it takes a message and returns events, holding only the set of
tool-use ids it has already seen so a redelivered block is not double-counted.

Tool events are what make a long search legible while it runs. A dispatch shows which
role was sent out, a search shows the query, and a page read names the page, so the
user can see the walk happening instead of watching a spinner for a minute.

`delta` and `message` describe the same prose twice, deliberately. A delta is a
fragment for the browser to paint as it arrives; the `message` that follows the
completed block is the authoritative text, and it is what the answer and the memory
write are assembled from. The browser displays deltas and stores messages, so a
dropped fragment costs a repaint rather than a corrupted transcript.

`reasoning` is fragments only, and only the orchestrator's. Nothing stores it, so
unlike prose there is no second authoritative copy to send when the block completes —
emitting the finished ThinkingBlock as well would simply print the thinking twice.
"""

from typing import Any, Callable, Optional

from claude_agent_sdk import (
    AssistantMessage,
    ResultMessage,
    StreamEvent,
    TextBlock,
    ToolUseBlock,
)

# Tool inputs worth surfacing in the one-line tool event, by bare tool name. Both
# dispatcher names are listed so the trail keeps naming the dispatched role whichever
# one the pinned CLI ships (see roles.DISPATCH_TOOLS).
_INPUT_HIGHLIGHTS: dict = {
    'Agent': ('subagent_type',),
    'Task': ('subagent_type',),
    'vector_search': ('query',),
}

# Tool inputs that are lists of page ids, named in the trail by the first page and a
# remainder. "retrieve_pages Q3 Report-pg3 +2" is a walk the user can follow;
# "retrieve_pages 3" is a number.
_INPUT_PAGES: dict = {
    'retrieve_pages': 'page_ids',
    'page_relations': 'page_ids',
}

# Tool inputs that are lists of something unlabelable, where the length is all there
# is to say. Node ids have no reader-facing name of their own.
_INPUT_COUNTS: dict = {
    'neighbor_pages': 'node_ids',
}


def bare_tool_name(name: str) -> str:
    """Strip the `mcp__<server>__` prefix so the trail shows `vector_search`, not the
    fully-qualified name. A built-in such as `Task` has no prefix and is returned
    unchanged."""
    return name.split('__')[-1]


class StreamMapper:
    def __init__(self, label_for: Optional[Callable[[str], str]] = None) -> None:
        self._seen_tool_ids: set = set()
        # Resolves a page id to its readable label. Optional so the mapper stays
        # usable without a store behind it, in which case the trail falls back to the
        # count it showed before.
        self._label_for = label_for

    def consume(self, message: Any) -> list:
        if isinstance(message, AssistantMessage):
            return self._consume_assistant(message)
        if isinstance(message, StreamEvent):
            return self._consume_partial(message)
        if isinstance(message, ResultMessage):
            return [self._consume_result(message)]
        return []

    def _label(self, page_id: str) -> str:
        """A page's readable name, or '' if there is no way to get one.

        Resolving a label is the first thing that loads the page graph when a search
        opens with retrieve_pages, so it is also the first place an S3 failure would
        surface. A trail line is decoration: it falls back to the count rather than
        taking the answer down with it.
        """
        if not self._label_for:
            return ''
        try:
            return self._label_for(page_id)
        except Exception:  # noqa: BLE001 - a label is never worth failing a search over
            return ''

    def _summarize_input(self, name: str, tool_input: dict) -> str:
        highlights = _INPUT_HIGHLIGHTS.get(name)
        if highlights:
            return ' '.join(str(tool_input[key]) for key in highlights if key in tool_input)

        page_key = _INPUT_PAGES.get(name)
        if page_key:
            values = tool_input.get(page_key) or []
            if not values:
                return ''
            first = self._label(str(values[0]))
            if not first:
                return f"{len(values)}"
            return f"{first} +{len(values) - 1}" if len(values) > 1 else first

        count_key = _INPUT_COUNTS.get(name)
        if count_key:
            values = tool_input.get(count_key) or []
            return f"{len(values)}" if values else ''
        return ''

    def _consume_partial(self, message: StreamEvent) -> list:
        """The orchestrator's answer and its reasoning, in fragments, as it writes them.

        Only when `parent_tool_use_id` is None. A subagent's deltas are the internal
        chatter of a search, and interleaving several concurrent explorers' reasoning
        into the answer bubble would be worse than showing nothing.

        `signature_delta` and `input_json_delta` fall through: a signature is not text,
        and a tool's arguments are already reported once the block completes.
        """
        if message.parent_tool_use_id is not None:
            return []
        event = message.event or {}
        if event.get('type') != 'content_block_delta':
            return []
        delta = event.get('delta') or {}
        kind = delta.get('type')
        if kind == 'text_delta':
            text = delta.get('text') or ''
            return [{'type': 'delta', 'content': text}] if text else []
        if kind == 'thinking_delta':
            thinking = delta.get('thinking') or ''
            return [{'type': 'reasoning', 'content': thinking}] if thinking else []
        return []

    def _consume_assistant(self, message: AssistantMessage) -> list:
        events = []
        for block in message.content:
            if isinstance(block, TextBlock):
                text = block.text.strip()
                if text:
                    events.append({'type': 'message', 'content': text})
            elif isinstance(block, ToolUseBlock):
                if block.id in self._seen_tool_ids:
                    continue
                self._seen_tool_ids.add(block.id)
                name = bare_tool_name(block.name)
                summary = self._summarize_input(name, block.input or {})
                events.append({'type': 'tool', 'content': f"{name} {summary}".strip()[:300]})
        return events

    def _consume_result(self, message: ResultMessage) -> dict:
        if message.is_error:
            return {'type': 'error', 'content': message.subtype or 'the search failed'}
        return {'type': 'status', 'content': 'complete'}
