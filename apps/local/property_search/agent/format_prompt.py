"""Assemble the prompt for one chat turn.

The envelope is the chat agent's, minus the topic id it used to scope a knowledge
base that no longer exists: the page context, the actions available on that page, the
conversation so far, and then the user's message, with the standing instructions last
so they are the closest thing to the question being answered.

History is replayed here rather than resumed inside the SDK. A turn is one `query()`
against a fresh CLI process, so the only memory it has is what this file hands it.
"""

import json
from pathlib import Path

PROMPTS = json.loads((Path(__file__).parent / "prompts.json").read_text())


def format_actions(actions: list) -> str:
    """Format action definitions into a prompt-friendly string."""
    if not actions:
        return ""

    lines = []
    for action in actions:
        name = action.get("name", "unknown")
        description = action.get("description", "")
        parameters = action.get("parameters", {})
        example = action.get("example", "")

        lines.append(f"### {name}")
        lines.append(f"{description}")
        if parameters:
            lines.append("Parameters:")
            for param, desc in parameters.items():
                lines.append(f"  - {param}: {desc}")
        if example:
            lines.append(f"Example: <act>{example}</act>")
        lines.append("")

    return "\n".join(lines)


def format_history(turns: list) -> str:
    """Format prior turns as a plain role-labelled transcript."""
    if not turns:
        return ""

    lines = []
    for turn in turns:
        role = "User" if turn.get("role") == "user" else "Assistant"
        lines.append(f"{role}: {turn.get('content') or ''}")
    return "\n\n".join(lines)


def build_enriched_prompt(
    page_context: str, actions: list, user_message: str, history: list = None
) -> str:
    """Build the prompt: page context, actions, conversation so far, then the message."""
    prompt = (
        f"<page_context>\n{page_context}\n</page_context>\n\n"
        f"<page_actions>\n{format_actions(actions)}\n</page_actions>\n\n"
    )

    conversation = format_history(history or [])
    if conversation:
        prompt += f"<conversation_so_far>\n{conversation}\n</conversation_so_far>\n\n"

    prompt += (
        f"<user_message>\n{user_message}\n</user_message>\n\n"
        f"{PROMPTS['instructions']}"
    )
    return prompt
