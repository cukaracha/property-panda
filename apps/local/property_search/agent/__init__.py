"""The in-app chat assistant, running on the user's own Claude subscription.

The cloud version of this app ran its chat agent on Bedrock AgentCore: a container
runtime the browser invoked directly, with the conversation in AgentCore Memory and
the tools behind an MCP gateway. Locally there is no runtime to invoke and no gateway
to reach, so the same agent runs in this process through `claude-agent-sdk`, which
drives the `claude` CLI against the token saved on the profile page.

What the browser sees is unchanged. Every turn is a stream of `{type, content}`
events -- reasoning, message, tool, action, status, error -- which is the one shape
`types/chatbot.ts` has always described, so the whole chat UI works against this
server without knowing the backend moved.
"""
