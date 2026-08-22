"""AgentCore Memory integration for the Chat Agent.

The memory resource is created and owned by Terraform; its id is injected into the
runtime as the MEMORY_ID environment variable. This module reads that id rather than
listing/creating memories at runtime.
"""

import os
import re

from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager

REGION = os.environ.get("AWS_REGION", "ap-southeast-2")

# Valid characters for AgentCore Memory IDs
_ID_PATTERN = re.compile(r'[^a-zA-Z0-9\-_/:]')


def sanitize_id(value: str, default: str = "default") -> str:
    """Sanitize an ID to match AgentCore Memory regex pattern.

    Pattern: [a-zA-Z0-9][a-zA-Z0-9-_/]*(?::[a-zA-Z0-9-_/]+)*[a-zA-Z0-9-_/]*
    """
    if not value:
        return default

    sanitized = _ID_PATTERN.sub('_', value)

    if sanitized and not sanitized[0].isalnum():
        sanitized = 'u' + sanitized

    return sanitized or default


def get_memory_id() -> str:
    """Get the memory ID from the environment (injected by Terraform)."""
    return os.environ["MEMORY_ID"]


def create_session_manager(session_id: str, actor_id: str) -> AgentCoreMemorySessionManager:
    """Create a session manager for the given session and actor."""
    memory_id = get_memory_id()
    config = AgentCoreMemoryConfig(
        memory_id=memory_id,
        session_id=sanitize_id(session_id, "default"),
        actor_id=sanitize_id(actor_id, "anonymous"),
    )
    return AgentCoreMemorySessionManager(
        agentcore_memory_config=config,
        region_name=REGION,
    )
