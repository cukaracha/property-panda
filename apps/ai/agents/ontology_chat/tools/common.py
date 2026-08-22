"""Shared plumbing for building tools and shaping their responses.

Every tool returns the same envelope: a single text block holding JSON, with
`is_error` set when the handler raised. A caller can therefore never mistake
"nothing happened" for "nothing was wrong", and the orchestrator has a typed
`error` field to branch on rather than a stack trace to parse.

The guard matters more here than in a request/response Lambda: these servers run
in-process, so an unhandled exception inside a handler would take down the whole
build rather than the one tool call.
"""

import json
from typing import Any, Awaitable, Callable

from claude_agent_sdk import SdkMcpTool, tool

Handler = Callable[[dict], Awaitable[dict]]


def respond(payload: Any) -> dict:
    return {'content': [{'type': 'text', 'text': json.dumps(payload, default=str)}]}


def respond_error(message: str) -> dict:
    return {
        'content': [{'type': 'text', 'text': json.dumps({'error': message})}],
        'is_error': True,
    }


def make_tool(name: str, description: str, schema: dict, handler: Handler) -> SdkMcpTool:
    """Wrap a handler so any exception becomes an error response, not a crash."""

    async def guarded(args: dict) -> dict:
        try:
            return await handler(args)
        except Exception as error:  # noqa: BLE001 - a tool must never crash the server
            import traceback

            print(f"[tool:{name}] {type(error).__name__}: {error}", flush=True)
            print(traceback.format_exc(), flush=True)
            return respond_error(f"{type(error).__name__}: {error}")

    return tool(name, description, schema)(guarded)
