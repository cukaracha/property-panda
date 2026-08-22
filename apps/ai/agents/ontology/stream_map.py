"""Turn the SDK message stream into the progress trail stored on the job row.

Nothing streams back to the browser — the frontend polls `/ontology/status` — so
the only reason to consume the stream is to leave a readable trail of what the
build did. The mapper reduces each message to a one-line event; `run_store` keeps
a bounded tail of them on the job row so a stalled or failed build can be
diagnosed from the row alone, without reading CloudWatch.

The mapper is pure: it takes a message and returns events, holding only the set of
tool-use ids it has already seen so a redelivered block is not double-counted.
"""

from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ResultMessage,
    TextBlock,
    ToolUseBlock,
)

# Tool inputs worth surfacing in the one-line tool event, by bare tool name. The
# trail only covers CONSOLIDATE now, and across both halves' tools only this one
# carries an argument that explains anything on its own.
_INPUT_HIGHLIGHTS: dict = {
    'fail_build': ('reason',),
}


def bare_tool_name(name: str) -> str:
    """Strip the `mcp__<server>__` prefix so the trail shows `commit_types`, not the
    fully-qualified name. A built-in has no prefix and is returned unchanged."""
    return name.split('__')[-1]


def _summarize_input(name: str, tool_input: dict) -> str:
    highlights = _INPUT_HIGHLIGHTS.get(name)
    if not highlights:
        return ''
    return ' '.join(str(tool_input[key]) for key in highlights if key in tool_input)


class StreamMapper:
    def __init__(self) -> None:
        self._seen_tool_ids: set = set()

    def consume(self, message: Any) -> list:
        if isinstance(message, AssistantMessage):
            return self._consume_assistant(message)
        if isinstance(message, ResultMessage):
            return [self._consume_result(message)]
        return []

    def _consume_assistant(self, message: AssistantMessage) -> list:
        events = []
        for block in message.content:
            if isinstance(block, TextBlock):
                text = block.text.strip()
                if text:
                    events.append({'type': 'message', 'content': text[:2000]})
            elif isinstance(block, ToolUseBlock):
                if block.id in self._seen_tool_ids:
                    continue
                self._seen_tool_ids.add(block.id)
                name = bare_tool_name(block.name)
                summary = _summarize_input(name, block.input or {})
                events.append({'type': 'tool', 'content': f"{name} {summary}".strip()[:500]})
        return events

    def _consume_result(self, message: ResultMessage) -> dict:
        return {
            'type': 'status',
            'content': 'failed' if message.is_error else 'complete',
            'subtype': message.subtype,
        }
