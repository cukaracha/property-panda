---
name: agentcore
description:
  How to author, build, and deploy a Python Amazon Bedrock AgentCore agent
  (direct code deployment) in this project, and invoke it from the React
  frontend. Use when creating an agent under apps/ai/agents/, writing a
  BedrockAgentCoreApp @app.entrypoint, building the ARM64 zip, wiring
  aws_bedrockagentcore_* Terraform with a Cognito JWT authorizer, or calling the
  agent over SSE.
---

# Bedrock AgentCore agents (direct code deployment)

How this project ships a Python agent to Amazon Bedrock AgentCore Runtime: the
agent source + ARM64 deps are zipped, uploaded to S3, and the runtime is
registered to pull that zip (no Docker / ECR). The browser invokes the runtime's
data plane **directly** with a Cognito **access** token; a Cognito JWT
authorizer on the runtime gates access - there is no API Gateway / Lambda proxy
in the chat path.

> **Never run `terraform plan`/`apply`** to deploy this - the user deploys
> manually. An agent's job ends at `terraform validate` (and the read-only
> build/verify steps below).

## Layout

```
apps/ai/agents/
├── build_agent.sh          # shared & reusable:  ./build_agent.sh <agent>
├── .gitignore              # */build/  +  __pycache__/  +  *.pyc
└── <agent>/                # e.g. chat
    ├── main.py             # entry point  (Terraform entry_point = ["main.py"])
    ├── agent_memory.py     # AgentCore Memory session manager
    ├── format_prompt.py    # builds the enriched prompt
    ├── stream_parser.py    # <message>/<act> tag state machine
    ├── prompts.json        # system prompt + output protocol
    └── requirements.txt    # strands-agents, bedrock-agentcore, boto3
```

Terraform for all agents lives in one file, `infra/terraform/ai_agents.tf`.

## Agent code (`main.py`)

`BedrockAgentCoreApp` + an **async-generator** `@app.entrypoint`. Each yielded
dict is serialized by AgentCore as one SSE line (`data: {...}`). Drive a Strands
`Agent`/`BedrockModel` and classify the stream into typed events
`{"type": reasoning|message|tool|action|status, "content": str}`.

```python
from typing import AsyncGenerator
from strands import Agent
from strands.models import BedrockModel
from bedrock_agentcore.runtime import BedrockAgentCoreApp

MODEL_ID = "global.anthropic.claude-sonnet-4-6"   # MUST match the Terraform IAM model ARNs
app = BedrockAgentCoreApp()
model = BedrockModel(
    model_id=MODEL_ID,
    additional_request_fields={                    # interleaved extended thinking → "reasoning" events
        "anthropic_beta": ["interleaved-thinking-2025-05-14"],
        "thinking": {"type": "enabled", "budget_tokens": 2000},
    },
)

@app.entrypoint
async def agent_invocation(payload: dict | str) -> AsyncGenerator[dict, None]:
    prompt, actor_id, session_id, page_context, actions = parse_payload(payload)
    agent = Agent(model=model, tools=[], system_prompt=SYSTEM_PROMPT,
                  session_manager=create_session_manager(session_id, actor_id))
    parser = StreamParser()
    async for event in agent.stream_async(build_enriched_prompt(page_context, actions, prompt)):
        if "data" in event and "reasoning" not in event:
            for parsed in parser.feed(event["data"]):
                yield parsed                                          # message / action (tag-classified)
        elif "reasoningText" in event:
            for f in parser.flush(): yield f
            yield {"type": "reasoning", "content": event["reasoningText"]}
        elif event.get("current_tool_use", {}).get("name"):
            for f in parser.flush(): yield f
            yield {"type": "tool", "content": event["current_tool_use"]["name"]}
        elif "result" in event:
            for f in parser.flush(): yield f
            yield {"type": "status", "content": "complete"}

if __name__ == "__main__":
    app.run()
```

`parse_payload` accepts either `{...}` directly or `{"input": {...}}` (the AWS
SDK wraps it), and pulls `prompt, actor_id, session_id, page_context, actions`.

## Output protocol (`<message>` / `<act>`) + StreamParser

The system prompt in `prompts.json` forces the model to wrap output in tags; a
small char-level `StreamParser` state machine classifies the stream:

- Wrap **all** user-facing text in `<message>…</message>`.
- Emit an action as `<act>{"name": "...", ...}</act>` (JSON) - only for actions
  listed in the `<page_actions>` block; never nest `<message>` and `<act>`.
- Text outside tags is treated as `reasoning`.

**`<act>` actions are approval-gated proposals, not executions.** The prompt
instructs the model to emit exactly **one** `<act>` and then **stop / end the
turn** - it must never claim the action happened ("Done", "I've filled the
form") or describe results, because nothing has run yet. The frontend renders a
confirmation card; the user's approve/reject begins the **next** SSE turn (a
message saying the action was approved-and-executed or rejected), and the agent
resumes from AgentCore Memory. Propose multiple actions one at a time across
turns. This is a prompt-only contract: `main.py` / `stream_parser.py` need no
change - once the model stops after `<act>`, the turn ends and the existing
finalize fires.

`StreamParser.feed(chunk)` yields
`{"type": "message"|"action"|"reasoning", "content": …}` as tags resolve;
`StreamParser.flush()` drains the buffer at stream end or before a non-text
event (tool/result).

## Memory (Terraform-owned)

Terraform creates the memory and injects its id as `MEMORY_ID`; the agent reads
the env var - do **not** list/create memories at runtime (that needs broader IAM
and adds a cold start).

```python
import os, re
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager

REGION = os.environ.get("AWS_REGION", "us-east-1")
_ID = re.compile(r"[^a-zA-Z0-9\-_/:]")            # AgentCore ids allow [a-zA-Z0-9-_/:]

def sanitize_id(value, default):
    s = _ID.sub("_", value or "")
    if s and not s[0].isalnum():
        s = "u" + s
    return s or default

def create_session_manager(session_id, actor_id):
    cfg = AgentCoreMemoryConfig(
        memory_id=os.environ["MEMORY_ID"],
        session_id=sanitize_id(session_id, "default"),
        actor_id=sanitize_id(actor_id, "anonymous"),
    )
    return AgentCoreMemorySessionManager(agentcore_memory_config=cfg, region_name=REGION)
```

## Build (`apps/ai/agents/build_agent.sh <agent>`)

AgentCore runs on ARM64, so download **aarch64** wheels regardless of host
(works from macOS). The agent's `*.py` and `*.json` plus all deps go at the zip
**ROOT**, so the entry file (`main.py`) sits at the root and matches
`entry_point = ["main.py"]`.

```bash
./build_agent.sh chat        # → apps/ai/agents/chat/build/agent.zip   (arg resolved relative to the script)
```

What the script does (per-agent dir resolved relative to the script):

```bash
python3 -m pip install -r "$AGENT_DIR/requirements.txt" --target "$PKG_DIR" \
  --platform manylinux2014_aarch64 --implementation cp --python-version 3.12 \
  --only-binary=:all: --upgrade
cp "$AGENT_DIR"/*.py "$PKG_DIR/"                    # also copy *.json if present (e.g. prompts.json)
( cd "$PKG_DIR" && zip -r -q "$ZIP_PATH" . -x '*.pyc' '*__pycache__*' )
```

Gitignore the artifacts in `apps/ai/agents/.gitignore`: `*/build/`,
`__pycache__/`, `*.pyc`.

## Terraform (`infra/terraform/ai_agents.tf`)

Provider `aws >= 6.22.0` (needed for `code_configuration`). AgentCore resource
**names allow underscores only** - build them with
`replace(local.name_prefix, "-", "_")` (`local.name_prefix` is
`lower("{stage}-{appName}")` built from `AppConfig.json`, restated here so this
skill stands alone). The S3 key embeds the source hash to bust the runtime's zip
cache.

```hcl
resource "aws_bedrockagentcore_memory" "chat" {
  name                  = "${replace(local.name_prefix, "-", "_")}_chat_memory"  # underscores only
  event_expiry_duration = 30                                                     # days (rolling)
}

resource "aws_bedrockagentcore_agent_runtime" "chat_agent" {
  agent_runtime_name = "${replace(local.name_prefix, "-", "_")}_chat_agent"
  role_arn           = aws_iam_role.agent_runtime.arn

  agent_runtime_artifact {
    code_configuration {
      runtime     = "PYTHON_3_12"
      entry_point = ["main.py"]                              # MUST match the zip-root file
      code { s3 { bucket = aws_s3_bucket.agent_artifacts.id, prefix = aws_s3_object.agent_zip.key } }
    }
  }

  network_configuration { network_mode = "PUBLIC" }          # no tools/VPC → PUBLIC

  authorizer_configuration {                                 # Cognito JWT inbound auth - reuse pool/client
    custom_jwt_authorizer {
      discovery_url   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.this.id}/.well-known/openid-configuration"
      allowed_clients = [aws_cognito_user_pool_client.this.id]
    }
  }

  environment_variables = {
    CODE_VERSION = local.agent_source_code_hash              # busts the S3-zip cache on code change
    MEMORY_ID    = aws_bedrockagentcore_memory.chat.id       # injected; also creates the dependency edge
  }
  depends_on = [aws_iam_role_policy.agent_permissions]
}
```

Build + upload:

```hcl
resource "terraform_data" "agent_build" {
  triggers_replace = local.agent_source_code_hash
  provisioner "local-exec" {
    command     = "${path.module}/../apps/ai/agents/build_agent.sh chat"
    working_dir = "${path.module}/../apps/ai/agents"
  }
}

resource "aws_s3_object" "agent_zip" {
  bucket      = aws_s3_bucket.agent_artifacts.id
  key         = "chat_agent/${local.agent_source_code_hash}.zip"   # hashed key → unique per version
  source      = "${path.module}/../apps/ai/agents/chat/build/agent.zip"
  source_hash = local.agent_source_code_hash
  depends_on  = [terraform_data.agent_build]
}
```

Execution role - trust (confused-deputy guarded) + least-privilege policy:

```hcl
# trust:  Service "bedrock-agentcore.amazonaws.com"  with conditions
condition { test = "StringEquals" variable = "aws:SourceAccount" values = [account_id] }
condition { test = "ArnLike"      variable = "aws:SourceArn"     values = ["arn:aws:bedrock-agentcore:${region}:${account_id}:*"] }

# policy statements (one aws_iam_policy_document):
#  InvokeModel       bedrock:InvokeModel{,WithResponseStream}
#                    on  inference-profile/<MODEL_ID>  AND  foundation-model/<foundation-model>  (must match MODEL_ID)
#  ReadArtifacts     s3:GetObject  on  "${agent_artifacts.arn}/*"
#  Logs              logs:CreateLogGroup/CreateLogStream/PutLogEvents/Describe*
#                    on  arn:aws:logs:<region>:<acct>:log-group:/aws/bedrock-agentcore/*
#  WorkloadIdentity  bedrock-agentcore:GetWorkloadAccessToken{,ForJWT,ForUserId}   (resources = ["*"])
#  AgentCoreMemory   bedrock-agentcore:GetMemory,CreateEvent,GetEvent,ListEvents,ListSessions,ListActors,RetrieveMemoryRecords
#                    scoped to [memory.arn, "${memory.arn}/*"]
```

Reuse the existing Cognito user pool + client for the authorizer (don't create
new ones). The runtime ARN is exposed as an output for the SPA.

## Frontend invocation

The SPA calls the data plane directly with the Cognito **access** token (not the
id token):

```ts
const REGION = import.meta.env.VITE_USER_POOL_ID.split('_')[0]; // "us-east-1_xxx" → region
const arn = encodeURIComponent(import.meta.env.VITE_AGENTCORE_RUNTIME_ARN);
const url = `https://bedrock-agentcore.${REGION}.amazonaws.com/runtimes/${arn}/invocations?qualifier=DEFAULT`;
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`, // ACCESS token (Bearer)
    'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': sessionId, // cross-turn session continuity
  },
  body: JSON.stringify({
    prompt,
    actor_id,
    session_id,
    bearer_token: accessToken,
    page_context,
    actions,
  }),
});
// stream: read res.body via getReader(), split on '\n', JSON.parse lines starting "data: " → {type, content}
```

`VITE_AGENTCORE_RUNTIME_ARN` is injected into the SPA build by Terraform's
`null_resource.deploy_ui`.

## Gotchas

- **Access vs id token.** AgentCore wants the Cognito **access** token as
  `Bearer`; the REST API Gateway authorizer wants the **id** token (raw, no
  `Bearer`). Wrong token → opaque 401/403.
- **Underscores only** in `agent_runtime_name` and memory `name` (hyphens are
  invalid) - use `replace(local.name_prefix, "-", "_")`.
- **`entry_point` must match the zip-root file** (`main.py`); the build copies
  sources to the zip root.
- **Provider `>= 6.22.0`** - `aws_bedrockagentcore_*` don't exist in 5.x.
- **ARM64 wheels even on macOS**
  (`--platform manylinux2014_aarch64 --only-binary=:all:`).
- **`MEMORY_ID` is injected, never discovered** at runtime - keeps IAM
  least-privilege, no cold-start.
- **Model id stays in sync** between `BedrockModel(model_id=…)` and the
  Terraform IAM inference-profile + foundation-model ARNs.
- **Gitignore `build/`** - the zip is large (vendored deps).
- **Never `terraform plan`/`apply`** from an agent - the user deploys; the agent
  stops at `validate`.

## Known-good defaults

| Thing         | Value                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| Region        | `us-east-1`                                                                                           |
| Runtime       | `PYTHON_3_12`                                                                                         |
| Model id      | `global.anthropic.claude-sonnet-4-6` (scope IAM inference-profile + foundation-model to match)        |
| Network       | `network_mode = "PUBLIC"`                                                                             |
| Memory expiry | `event_expiry_duration = 30` - days, rolling (events older than 30d auto-delete; the memory persists) |
| Deps          | `strands-agents`, `bedrock-agentcore`, `boto3`                                                        |

## A2A subagent fleet (orchestrator + auto-discovered specialists)

The chat agent doubles as an **orchestrator** of a growing fleet of **A2A
subagents**. Each subagent is its own AgentCore Runtime that the orchestrator
discovers and delegates to over the **A2A protocol**. Adding subagent N+1 is
near-mechanical: a new runtime + one SSM parameter - **no orchestrator code
change or redeploy**. Three layers, each with discovery at its own level:

1. **Subagent → tools**: a subagent attaches the _whole_ MCP gateway per request
   (tools auto-discovered) - same as the chat agent.
2. **Registry ("A2A gateway")**: an SSM Parameter Store path
   `/<name_prefix>/a2a-subagents/*`; each subagent's Terraform writes one
   parameter = its runtime ARN. There is **no managed AWS service that
   aggregates+discovers a fleet of agents** (the AgentCore Gateway aggregates
   _tools_ via MCP targets, but fronts _agents_ only as isolated path-based HTTP
   passthroughs) - so this thin registry is the discovery layer.
3. **Orchestrator → subagents**: the chat agent reads the registry per request
   and feeds the URLs to `A2AClientToolProvider` (Strands' OOTB A2A fleet
   client), which fetches each agent card and exposes the fleet as `a2a_*`
   tools.

**Auth splits by direction - do NOT replay the user token to the gateway.** Two
distinct hops, two distinct credentials:

- **Inbound (front doors)** - the user's Cognito access token authenticates the
  call _into_ each runtime: browser → chat runtime, and chat → subagent (A2A).
  Each runtime's `custom_jwt_authorizer` validates that token and then
  **strips** it - it never reaches container code. So the orchestrator puts the
  user token on `Authorization` for the A2A call; that's all the subagent's
  front door needs.
- **Outbound (chat/subagent → MCP gateway)** - each agent mints its **own**
  token via **AgentCore Identity** (`@requires_access_token(auth_flow="M2M")`,
  OAuth2 client-credentials), keyed off the `WorkloadAccessToken` AgentCore
  injects into every runtime. No user-token replay, no custom header.

The earlier "forward the user token on
`X-Amzn-Bedrock-AgentCore-Runtime-Custom-Authorization` and read it back in the
subagent" approach was **abandoned**: AgentCore does **not** reliably forward
custom headers into an A2A container (the subagent only ever sees `baggage` +
`WorkloadAccessToken`), and a replayed user token expires mid-chain. M2M fixes
both. See the A2A gotchas below.

### Subagent layout & code (`apps/ai/agents/<name>/`)

An A2A agent **must be a container** (ARM64) serving the protocol on
`0.0.0.0:9000` at `/`, with the card at `/.well-known/agent-card.json` - it
**cannot** be the zip pattern.

```
apps/ai/agents/
├── build_agent.sh             # zip agents (chat)
├── build_agent_container.sh   # container agents:  <agent> <repo-url> <tag> <region>  → buildx ARM64 → ECR
└── <name>/                    # e.g. number_specialist
    ├── main.py                # serve_a2a(GatewayBackedExecutor(...), agent_card=…, port=9000)
    ├── requirements.txt       # strands-agents, bedrock-agentcore[a2a]==1.15.0 (pinned), a2a-sdk>=0.3,<0.4, boto3
    └── Dockerfile             # FROM --platform=linux/arm64 python:3.12-slim; ENV DOCKER_CONTAINER=1; EXPOSE 9000
```

`serve_a2a` (from `bedrock_agentcore.runtime`) binds `0.0.0.0` only inside a
container (it checks `/.dockerenv` or `DOCKER_CONTAINER`). The agent **card
name/description/skills are what the orchestrator discovers and reasons over** -
make them descriptive.

**Attach the whole gateway per request** by overriding the executor's factory
seam. The subagent mints its **own** M2M gateway token (AgentCore Identity),
opening a live MCP session that stays open across the stream - it does **not**
read any forwarded user token:

```python
from bedrock_agentcore.runtime import serve_a2a
from bedrock_agentcore.identity.auth import requires_access_token
from strands.multiagent.a2a.executor import StrandsA2AExecutor

GATEWAY_CREDENTIAL_PROVIDER = os.environ.get("GATEWAY_CREDENTIAL_PROVIDER")  # OAuth2 cred-provider name (Terraform)
GATEWAY_SCOPES = os.environ.get("GATEWAY_SCOPES", "").split()               # e.g. ["gateway/invoke"]

async def gateway_access_token():                          # the agent's OWN gateway token (M2M)
    if not GATEWAY_CREDENTIAL_PROVIDER:
        return None                                        # unconfigured → skip the gateway
    @requires_access_token(provider_name=GATEWAY_CREDENTIAL_PROVIDER, scopes=GATEWAY_SCOPES,
                           auth_flow="M2M", into="access_token")            # keyed off injected WorkloadAccessToken
    async def _fetch(*, access_token: str = "") -> str:
        return access_token
    return await _fetch()

class GatewayBackedExecutor(StrandsA2AExecutor):
    async def _run_with_context_agent(self, context_id, content_blocks, invocation_state, updater, stream_state):
        mcp = build_gateway_client(await gateway_access_token())   # same MCPClient shape as the chat agent
        if mcp is None:
            await self._stream_agent(build_agent([]), content_blocks, invocation_state, updater, stream_state); return
        with mcp:                                          # session stays open across the awaited stream
            await self._stream_agent(build_agent(mcp.list_tools_sync()), content_blocks, invocation_state, updater, stream_state)

serve_a2a(
    GatewayBackedExecutor(agent_factory=lambda cid: build_agent([]),   # factory only satisfies the ctor; this path ignores it
                          enable_a2a_compliant_streaming=True),        # spec-compliant artifacts; silences the legacy warning
    agent_card=build_card(), port=9000,                                # build_card() → AgentCard(name, description, skills=[AgentSkill(...)])
)
```

`build_agent(tools)` is a Strands `Agent` with a `BedrockModel` invoked directly
using the runtime's in-account execution-role credentials (`region_name=REGION`,
no `boto_session` - same as the chat agent); **stateless** (no
`session_manager` - the orchestrator owns memory).

### Orchestrator wiring (`apps/ai/agents/chat/main.py`)

Read the registry → build the provider per request → merge `provider.tools` with
the gateway tools. Keep it **non-raising** so a registry hiccup degrades to "no
subagents":

```python
def discover_subagent_urls():
    from bedrock_agentcore.runtime import build_runtime_url
    ssm = boto3.client("ssm", region_name=BEDROCK_REGION)              # in-account exec-role creds
    urls = []
    for page in ssm.get_paginator("get_parameters_by_path").paginate(Path=SUBAGENT_REGISTRY_PATH, Recursive=True):
        for p in page["Parameters"]:                                  # p["Value"] = runtime ARN
            urls.append(build_runtime_url(p["Value"]).rstrip("/") + "/")   # build_runtime_url omits the trailing slash - add it
    return urls

def make_subagent_provider(bearer_token, session_id):
    from strands_tools.a2a_client import A2AClientToolProvider
    urls = discover_subagent_urls()
    if not urls: return None
    return A2AClientToolProvider(known_agent_urls=urls,
        httpx_client_args={"headers": {
            "Authorization": f"Bearer {bearer_token}",                                    # INBOUND front-door JWT auth (consumed + stripped)
            "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session_id}, "timeout": 120})  # NO custom token header - subagent uses M2M
```

The orchestrator forwards the user token **only** on `Authorization` for the
subagent's front-door auth; it does **not** pass any `X-Amzn-...-Custom-*` token
header (the subagent reaches the gateway with its own M2M token). The
orchestrator's _own_ gateway call also uses `gateway_access_token()` - the same
M2M helper as the subagent, not the user token.

Pin **`strands-agents-tools>=0.2.14`** - the first release with BOTH the
[#263](https://github.com/strands-agents/tools/pull/263) fix (it no longer
re-derives the AgentCore invocation URL - honours `known_agent_urls`) AND
`httpx_client_args` (how the `Authorization` + session-id headers reach the
subagent, used for card discovery _and_ message-send). Keep `a2a-sdk` pinned to
the **same** range (`>=0.3,<0.4`) on client and server. Tell the model it may
delegate via the `a2a_*` tools in the **mutable** prompt (`prompts.json`
`instructions`), not the `base_do_not_change` system prompt.

### Outbound gateway auth - AgentCore Identity M2M (`infra/terraform/backend_auth.tf` + `infra/terraform/ai_gateway.tf`)

Shared by the chat agent and every subagent (not per-subagent). Each agent calls
`@requires_access_token(auth_flow="M2M")` against an **OAuth2 credential
provider**, which runs a Cognito **client-credentials** grant and returns the
agent's own gateway token. Wiring:

```hcl
# 1) Cognito M2M plumbing (backend_auth.tf). Client-credentials needs a hosted-UI domain
#    (token endpoint) + a resource server (Cognito requires ≥1 custom scope) + a secret client.
resource "aws_cognito_user_pool_domain" "this" {
  domain       = "${local.name_prefix}-${data.aws_caller_identity.current.account_id}"  # globally unique
  user_pool_id = aws_cognito_user_pool.this.id
}
resource "aws_cognito_resource_server" "gateway" {
  identifier = "gateway"  name = "${local.name_prefix}-gateway"  user_pool_id = aws_cognito_user_pool.this.id
  scope { scope_name = "invoke"  scope_description = "Invoke the MCP gateway" }            # → scope id "gateway/invoke"
}
resource "aws_cognito_user_pool_client" "gateway_m2m" {
  name = "${local.name_prefix}-gateway-m2m"  user_pool_id = aws_cognito_user_pool.this.id
  generate_secret = true                                                                   # secret client (server-side only)
  allowed_oauth_flows_user_pool_client = true  allowed_oauth_flows = ["client_credentials"]
  allowed_oauth_scopes = aws_cognito_resource_server.gateway.scope_identifiers             # ["gateway/invoke"]
  depends_on = [aws_cognito_user_pool_domain.this]
}

# 2) The credential provider (ai_gateway.tf). AgentCore vaults the secret (client_secret_arn
#    is computed) - no Secrets Manager. discovery_url's token_endpoint resolves to the domain.
resource "aws_bedrockagentcore_oauth2_credential_provider" "gateway" {
  name = "${replace(local.name_prefix, "-", "_")}_gateway_m2m"  credential_provider_vendor = "CustomOauth2"
  oauth2_provider_config { custom_oauth2_provider_config {
    client_id     = aws_cognito_user_pool_client.gateway_m2m.id
    client_secret = aws_cognito_user_pool_client.gateway_m2m.client_secret
    oauth_discovery { discovery_url = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.this.id}/.well-known/openid-configuration" }
  } }
}

# 3) Gateway authorizer accepts the M2M client id (keep the user client during rollout).
allowed_clients = [aws_cognito_user_pool_client.this.id, aws_cognito_user_pool_client.gateway_m2m.id]
```

Then on **both** runtime roles + runtimes (`ai_agents.tf`):

```hcl
statement { sid = "GatewayOauth2Token"  actions = ["bedrock-agentcore:GetResourceOauth2Token"]
            resources = ["*"] }   # NOT scopeable - see below; same precedent as WorkloadIdentity
statement { sid = "ReadGatewayM2MSecret"  actions = ["secretsmanager:GetSecretValue"]   # the vaulted client secret, read under THIS role
            resources = ["arn:aws:secretsmanager:${region}:${account}:secret:bedrock-agentcore-identity!default/oauth2/${provider.name}-*"] }
# env: GATEWAY_CREDENTIAL_PROVIDER = …gateway.name ; GATEWAY_SCOPES = join(" ", …gateway.scope_identifiers)
```

**`GetResourceOauth2Token` does not scope cleanly - grant it
`resources = ["*"]`** (like the `WorkloadIdentity` action family). It authorizes
against a _chain_ of dynamic/singleton AgentCore Identity resources - the
credential provider, the runtime's auto-created **workload identity**
(`…/workload-identity/<agent_runtime_name>-<random>`), the
**`workload-identity-directory/default`** itself, and the token vault - and IAM
reveals them **one at a time across applies** (fix one ARN, the next denial
names the next resource). Enumerating is whack-a-mole; the call is already gated
by the runtime's injected `WorkloadAccessToken`, so `["*"]` for this single
action is the pragmatic, precedented choice.

**The role also needs `secretsmanager:GetSecretValue`.** A separate, non-obvious
grant: while _serving_ `GetResourceOauth2Token`, AgentCore Identity reads the
credential provider's vaulted client secret from Secrets Manager **under the
caller (execution-role) identity** - so even after the `bedrock-agentcore`
action is allowed, the mint fails with a Secrets Manager deny naming the role.
The secret lives at the reserved name
`bedrock-agentcore-identity!default/oauth2/<provider-name>-<rand>` (the `!` is a
literal char). Scope to `…/oauth2/${provider.name}-*` - `provider.name` is
plan-time-known (no churn from the _computed_ `client_secret_arn`), and `-*`
absorbs the random suffixes and survives rotation. No `kms:Decrypt` needed
(AWS-managed vault key → implicit same-account decrypt); add a CMK-scoped
decrypt only if a deploy surfaces a `kms:Decrypt` deny naming a CMK.

The gateway authorizer only checks the **client id**, not the scope - but
Cognito still requires the resource-server scope to mint the token. A
client-credentials token carries `token_use=access`, `client_id=<m2m>`, no
`aud` - same issuer/discovery as the user token.

### Terraform - one self-contained block per subagent (`infra/terraform/ai_agents.tf`)

Per-agent unit =
`{ source_hash → ECR repo → container build → A2A runtime → IAM role → SSM param }`.
Reuse the chat agent's trust doc and Cognito pool/client + gateway.

```hcl
locals {
  subagent_source_hash = sha1(join("", [filesha256(".../main.py"), filesha256(".../requirements.txt"),
                                         filesha256(".../Dockerfile"), filesha256(".../build_agent_container.sh")]))
  subagent_image_uri   = "${aws_ecr_repository.subagent.repository_url}:${local.subagent_source_hash}"  # hash tag = cache-bust
}

resource "aws_ecr_repository" "subagent" { name = "${local.name_prefix}-number-specialist"
  image_tag_mutability = "MUTABLE"  force_delete = true }

resource "terraform_data" "subagent_build" {                 # buildx ARM64 → ECR, only on source change
  triggers_replace = local.subagent_source_hash
  provisioner "local-exec" {
    command     = "./build_agent_container.sh number_specialist ${aws_ecr_repository.subagent.repository_url} ${local.subagent_source_hash} ${var.aws_region}"
    working_dir = "${path.module}/../apps/ai/agents"
  }
  depends_on = [aws_ecr_repository.subagent]
}

resource "aws_bedrockagentcore_agent_runtime" "number_specialist" {
  agent_runtime_name = "${replace(local.name_prefix, "-", "_")}_number_specialist"
  role_arn           = aws_iam_role.subagent_runtime.arn
  agent_runtime_artifact { container_configuration { container_uri = local.subagent_image_uri } }
  network_configuration  { network_mode = "PUBLIC" }
  protocol_configuration { server_protocol = "A2A" }          # valid: HTTP, MCP, A2A, AGUI
  authorizer_configuration { custom_jwt_authorizer { discovery_url = "…", allowed_clients = [client.id] } }
  environment_variables = { GATEWAY_URL = …,  # NOT AGENTCORE_RUNTIME_URL; Bedrock invoked directly via the exec role
                            GATEWAY_CREDENTIAL_PROVIDER = …gateway.name, GATEWAY_SCOPES = join(" ", …scope_identifiers) }  # M2M outbound auth
  depends_on = [terraform_data.subagent_build, aws_iam_role_policy.subagent_permissions]
}

resource "aws_ssm_parameter" "number_specialist_registry" {   # the single registration point
  name = "/${local.name_prefix}/a2a-subagents/number_specialist"  type = "String"
  value = aws_bedrockagentcore_agent_runtime.number_specialist.agent_runtime_arn
}
```

Subagent **execution role** = chat role MINUS AgentCore Memory + S3 artifacts,
PLUS ECR pull:

```hcl
# clone of the chat role's InvokeModel / Marketplace / Logs / WorkloadIdentity / GatewayOauth2Token, plus:
statement { sid = "ECRImageAccess"  actions = ["ecr:BatchGetImage","ecr:GetDownloadUrlForLayer"]  resources = [aws_ecr_repository.subagent.arn] }
statement { sid = "ECRTokenAccess"  actions = ["ecr:GetAuthorizationToken"]  resources = ["*"] }   # no resource scoping
```

**Orchestrator role + runtime** get one addition each: an SSM read
(`ssm:GetParametersByPath`/`GetParameter(s)` on
`parameter/<name_prefix>/a2a-subagents` and `…/*`) and the
`SUBAGENT_REGISTRY_PATH = "/${local.name_prefix}/a2a-subagents"` env var. **No**
`bedrock-agentcore:InvokeAgentRuntime` - the forwarded JWT authorizes the A2A
call. Do **not** add a `depends_on` from the chat runtime to the SSM param (that
would couple them and defeat zero-redeploy onboarding).

### Add subagent #2 (the repeatable recipe)

1. `cp -r apps/ai/agents/number_specialist apps/ai/agents/<new>`; edit `main.py`
   (`AGENT_NAME`, `AGENT_DESCRIPTION`, `SYSTEM_PROMPT`, `build_card()` skills).
2. Copy the `number_specialist` Terraform block in
   `infra/terraform/ai_agents.tf`, rename resources, point the source hash at
   the new dir, add its `aws_ssm_parameter`.
3. Deploy. The orchestrator discovers it on the **next turn** - no chat-agent
   change.

### A2A gotchas (in addition to the zip ones above)

- **Don't pass user tokens to downstream resources - use workload identity.**
  AgentCore does **not** reliably forward arbitrary `X-Amzn-...-Custom-*`
  headers into an A2A container: in practice the subagent's
  `get_request_headers()` shows only `baggage` + `workloadaccesstoken`, so a
  token re-sent on `X-Amzn-Bedrock-AgentCore-Runtime-Custom-Authorization` never
  arrives and the agent silently runs **tool-less** ("answers" without calling
  its tool). The fix is not a better header - it's the right pattern: each agent
  mints its **own** gateway token via **AgentCore Identity**
  (`@requires_access_token(auth_flow="M2M")`, keyed off the injected
  `WorkloadAccessToken`). Confirm via the logged `inbound request header keys`
  line (expect just `baggage`/`workloadaccesstoken`) and a "minted M2M gateway
  token" line.
- **Token passthrough is also fragile to expiry - another reason to split
  auth.** When one user token is replayed across hops (chat front door →
  subagent front door → MCP gateway), AgentCore rejects any token with **<60s of
  life left** ("ineffectual token that will expire in under one minute"), and
  the **longest chain fails first** - making it look like "the subagent can't
  reach its tools" while the chat agent's own one-hop call squeaks through. M2M
  removes the gateway hop from the user token's lifetime entirely. The user
  token still authenticates the **inbound** front doors, so keep it fresh
  anyway: refresh proactively (Amplify's `fetchAuthSession()` hands back a
  cached near-expiry token until it has actually expired - use
  `fetchAuthSession({ forceRefresh: true })` within a safety margin) and/or
  lengthen the Cognito `access_token_validity` (default 60 min).
- **`serve_a2a` installs no stdout log handler** (unlike `BedrockAgentCoreApp`),
  and the Strands A2A executor **swallows exceptions** into a generic `failed`
  task surfaced to the caller as `"Agent execution failed"` - with nothing in
  CloudWatch. Add `logging.basicConfig(level=logging.INFO, stream=sys.stdout)`
  and `print(traceback.format_exc())` in the executor body (and `flush=True` on
  prints - container stdout is block-buffered), or real errors are invisible.
  The empty-logs-but-failed-task symptom is almost always an exception thrown
  before your first print.
- **`bedrock-agentcore[a2a]`** - the `a2a` extra pulls `a2a-sdk` (not vendored
  by default).
- **Pin `bedrock-agentcore` itself** (e.g. `==1.15.0`, matching the chat agent's
  vendored version) - an unpinned install lets identity / header-forwarding
  behaviour shift between rebuilds, the classic "worked once, then stopped after
  a redeploy" bug. The pinned version must ship
  `bedrock_agentcore.identity.auth.requires_access_token` (the M2M decorator).
- **Pin `a2a-sdk` identically** client↔server (`>=0.3,<0.4`) - a major drift
  breaks the wire.
- **Container binds `0.0.0.0` only** with `DOCKER_CONTAINER=1` (or
  `/.dockerenv`); else it binds `127.0.0.1` and AgentCore can't reach it.
- **Hash-tag images, never `:latest`** - the changing URI is what busts
  AgentCore's image cache.
- **Trailing slash** on the invocation URL: `build_runtime_url(arn)` omits it;
  append `/` or card resolution 404s.
- **Leave `AGENTCORE_RUNTIME_URL` unset** - AgentCore Runtime **injects it at
  runtime** and `serve_a2a` uses it to override the served card's `url` to the
  real invocation URL (so the card the orchestrator fetches points back
  correctly; the a2a-sdk client POSTs to `card.url`). You can't set it via
  Terraform anyway (a runtime can't self-reference its own ARN at creation). The
  `build_card()` `url` is just a local-testing placeholder. The #263 fix is
  still required so the _client_ discovers/sends via `known_agent_urls` rather
  than a name-derived URL.
- **ARM64 buildx** needs qemu/binfmt on Intel hosts; Apple silicon builds
  natively.
- **Keep registry reads + provider construction non-raising** - degrade to "no
  subagents".

### A2A known-good defaults

| Thing                  | Value                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| A2A port / path / card | `9000` / `/` / `/.well-known/agent-card.json`                                                                                      |
| Container base         | `python:3.12-slim` (ARM64)                                                                                                         |
| Runtime artifact       | `container_configuration { container_uri }` + `protocol_configuration { server_protocol = "A2A" }`                                 |
| Registry path          | `/<name_prefix>/a2a-subagents/<name>` = runtime ARN                                                                                |
| Client                 | `strands-agents-tools>=0.2.14` (`A2AClientToolProvider`), `a2a-sdk>=0.3,<0.4`, `bedrock-agentcore[a2a]==1.15.0`                    |
| Gateway auth           | M2M via `@requires_access_token(auth_flow="M2M")` + `aws_bedrockagentcore_oauth2_credential_provider` - NOT user-token passthrough |

## Verify (read-only - no `terraform plan`/`apply`)

```bash
apps/ai/agents/build_agent.sh chat                                   # build the zip
unzip -Z1 apps/ai/agents/chat/build/agent.zip | grep -E '^(main\.py|prompts\.json)$'   # entry + data at ROOT
unzip -Z1 apps/ai/agents/chat/build/agent.zip | grep -Ei '^(a2a|strands_tools)/' | head # a2a-sdk + provider vendored
python -m py_compile apps/ai/agents/chat/*.py apps/ai/agents/number_specialist/*.py
docker buildx build --platform linux/arm64 -t number-specialist:test apps/ai/agents/number_specialist   # build only, no --push
cd infra/terraform && terraform fmt -check && terraform validate          # validate only
cd apps/ui/web && npm run build                             # type-checks the SPA
```

End-to-end (after the user deploys): ask the chat agent for a random number → it
discovers the fleet from the registry, an `a2a_*` tool event fires, the
subagent's gateway tool call runs, and a number returns. To prove
auto-discovery, deploy a 2nd subagent (new runtime + one SSM param) and confirm
the orchestrator routes to it with **no chat-agent change**.

Cross-check the contract lines up end to end: SSE `data: {type,content}` ↔ body
keys (`prompt/actor_id/session_id/page_context/actions`) ↔ the
`X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` header ↔ access-token `Bearer` ↔
the `custom_jwt_authorizer` (`discovery_url` + `allowed_clients`).
