"""Prompt formatting for the chat agent."""

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


def build_enriched_prompt(topic_id: str, page_context: str, actions: list, user_message: str) -> str:
    """Build the enriched prompt with unit id, page context, actions, user message, and instructions."""
    formatted_actions = format_actions(actions)
    instructions = PROMPTS["instructions"]

    return (
        f"<topic_id>\n{topic_id}\n</topic_id>\n\n"
        f"<page_context>\n{page_context}\n</page_context>\n\n"
        f"<page_actions>\n{formatted_actions}\n</page_actions>\n\n"
        f"<user_message>\n{user_message}\n</user_message>\n\n"
        f"{instructions}"
    )
