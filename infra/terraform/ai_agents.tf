# ai domain — the chat agent deployed to Amazon Bedrock AgentCore Runtime via
# "direct code deployment": the agent source + ARM64 deps are zipped
# (apps/ai/agents/build_agent.sh), uploaded to a dedicated S3 bucket, and the
# runtime is registered to pull that zip. No Docker / ECR.
#
# Inbound auth is a Cognito JWT authorizer reusing the pool/client from
# backend_auth.tf, so the browser invokes the runtime directly with a Cognito
# access token — there is no API Gateway / Lambda proxy in the chat path.

locals {
  # Hash of the agent sources + build script. Drives BOTH the conditional
  # rebuild (terraform_data.build) and the S3 re-upload. All inputs exist at
  # plan time, so there's no chicken-and-egg with the not-yet-built zip.
  agent_source_code_hash = sha1(join("", [
    filesha256("${path.module}/../../apps/ai/agents/chat/main.py"),
    filesha256("${path.module}/../../apps/ai/agents/chat/stream_parser.py"),
    filesha256("${path.module}/../../apps/ai/agents/chat/agent_memory.py"),
    filesha256("${path.module}/../../apps/ai/agents/chat/format_prompt.py"),
    filesha256("${path.module}/../../apps/ai/agents/chat/prompts.json"),
    filesha256("${path.module}/../../apps/ai/agents/chat/requirements.txt"),
    filesha256("${path.module}/../../apps/ai/agents/build_agent.sh"),
  ]))

  agent_zip_path = "${path.module}/../../apps/ai/agents/chat/build/agent.zip"
}

# ---------------------------------------------------------------------------
# Artifact bucket — holds the agent zip
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "agent_artifacts" {
  bucket        = "${local.name_prefix}-agentcore-${data.aws_caller_identity.current.account_id}-${local.region}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "agent_artifacts" {
  bucket                  = aws_s3_bucket.agent_artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ---------------------------------------------------------------------------
# Build the zip — only when agent sources or the build script change
# ---------------------------------------------------------------------------
resource "terraform_data" "agent_build" {
  triggers_replace = local.agent_source_code_hash

  provisioner "local-exec" {
    command     = "./build_agent.sh chat"
    working_dir = "${path.module}/../../apps/ai/agents"
  }
}

# Upload the zip. source_hash uses the source-file hash (available at plan time)
# rather than reading the zip, and depends_on forces the build to run first.
# The hash-named key also means each code version lands at a unique S3 path,
# which helps bust AgentCore's S3-zip cache.
resource "aws_s3_object" "agent_zip" {
  bucket      = aws_s3_bucket.agent_artifacts.id
  key         = "chat_agent/${local.agent_source_code_hash}.zip"
  source      = local.agent_zip_path
  source_hash = local.agent_source_code_hash

  depends_on = [terraform_data.agent_build]
}

# ---------------------------------------------------------------------------
# Execution role assumed by the AgentCore runtime
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "agent_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["bedrock-agentcore.amazonaws.com"]
    }

    # Confused-deputy protection: only AgentCore resources in this account/region.
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:bedrock-agentcore:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
    }
  }
}

resource "aws_iam_role" "agent_runtime" {
  name               = "${local.name_prefix}-chat-agent-runtime"
  assume_role_policy = data.aws_iam_policy_document.agent_trust.json
}

data "aws_iam_policy_document" "agent_permissions" {
  # Invoke any Bedrock foundation model / inference profile directly in this
  # account (apps/ai/agents/chat/main.py `create_agent` builds BedrockModel with the
  # runtime's execution-role credentials). Model selection lives in the agent code
  # (`MODEL_ID`); IAM is intentionally not pinned to a specific model so model swaps
  # don't require a policy change. Inference profiles route to foundation models in
  # member regions, so both the profile and foundation-model ARNs are allowed (any
  # region) — required for `global.` cross-region profiles.
  statement {
    sid = "InvokeModel"

    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]

    resources = [
      "arn:aws:bedrock:*::foundation-model/*",
      "arn:aws:bedrock:*:${data.aws_caller_identity.current.account_id}:inference-profile/*",
    ]
  }

  # Bedrock serves newer Anthropic models (Sonnet 4.x) through AWS Marketplace.
  # The first invocation auto-subscribes the account, which requires these
  # actions on the calling principal. Without them, Converse/ConverseStream
  # fails with AccessDeniedException citing aws-marketplace:Subscribe /
  # ViewSubscriptions. These actions don't support resource scoping.
  statement {
    sid = "BedrockMarketplaceSubscription"

    actions = [
      "aws-marketplace:Subscribe",
      "aws-marketplace:ViewSubscriptions",
    ]

    resources = ["*"]
  }

  # Read the agent zip from the artifact bucket.
  statement {
    sid       = "ReadArtifacts"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.agent_artifacts.arn}/*"]
  }

  # Read the A2A subagent registry (SSM Parameter Store) to auto-discover the fleet.
  # The chat agent (orchestrator) reads this path per request — see
  # apps/ai/agents/chat/main.py `discover_subagent_urls`. GetParametersByPath is evaluated
  # against the path ARN; GetParameter(s) against each parameter ARN under it.
  statement {
    sid = "ReadSubagentRegistry"

    actions = [
      "ssm:GetParametersByPath",
      "ssm:GetParameter",
      "ssm:GetParameters",
    ]

    resources = [
      "arn:aws:ssm:${local.region}:${data.aws_caller_identity.current.account_id}:parameter/${local.name_prefix}/a2a-subagents",
      "arn:aws:ssm:${local.region}:${data.aws_caller_identity.current.account_id}:parameter/${local.name_prefix}/a2a-subagents/*",
    ]
  }

  # Write runtime logs.
  statement {
    sid = "Logs"

    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
      "logs:DescribeLogGroups",
    ]

    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/bedrock-agentcore/*"]
  }

  # Workload identity token required by the AgentCore runtime contract.
  statement {
    sid = "WorkloadIdentity"

    actions = [
      "bedrock-agentcore:GetWorkloadAccessToken",
      "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
      "bedrock-agentcore:GetWorkloadAccessTokenForUserId",
    ]

    resources = ["*"]
  }

  # Mint the agent's OWN gateway token via AgentCore Identity (M2M) instead of
  # replaying the user's token. GetResourceOauth2Token authorizes against a CHAIN
  # of dynamic/singleton AgentCore Identity resources — the credential provider,
  # the runtime's auto-created workload identity (random suffix), AND the
  # workload-identity-directory/default + token vault — revealed one at a time
  # across deploys. They don't scope cleanly, so use ["*"], matching the
  # WorkloadIdentity statement below. The call is still gated by the runtime's
  # injected WorkloadAccessToken.
  statement {
    sid       = "GatewayOauth2Token"
    actions   = ["bedrock-agentcore:GetResourceOauth2Token"]
    resources = ["*"]
  }

  # While serving GetResourceOauth2Token, AgentCore Identity reads the vaulted
  # Cognito M2M client secret from Secrets Manager UNDER THIS ROLE's identity, so
  # the role needs GetSecretValue on it. Scoped to the provider's reserved secret
  # name (bedrock-agentcore-identity!default/oauth2/<provider-name>-...); the `-*`
  # absorbs the AgentCore + Secrets Manager random suffixes and survives rotation.
  # `.name` is plan-time-known (no computed-ARN churn) and still creates the edge.
  statement {
    sid       = "ReadGatewayM2MSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["arn:aws:secretsmanager:${local.region}:${data.aws_caller_identity.current.account_id}:secret:bedrock-agentcore-identity!default/oauth2/${aws_bedrockagentcore_oauth2_credential_provider.gateway.name}-*"]
  }

  # Read/write conversation events on the Terraform-managed memory only.
  statement {
    sid = "AgentCoreMemory"

    actions = [
      "bedrock-agentcore:GetMemory",
      "bedrock-agentcore:CreateEvent",
      "bedrock-agentcore:GetEvent",
      "bedrock-agentcore:ListEvents",
      "bedrock-agentcore:ListSessions",
      "bedrock-agentcore:ListActors",
      "bedrock-agentcore:RetrieveMemoryRecords",
    ]

    resources = [
      aws_bedrockagentcore_memory.chat.arn,
      "${aws_bedrockagentcore_memory.chat.arn}/*",
    ]
  }
}

resource "aws_iam_role_policy" "agent_permissions" {
  name   = "${local.name_prefix}-chat-agent-permissions"
  role   = aws_iam_role.agent_runtime.id
  policy = data.aws_iam_policy_document.agent_permissions.json
}

# ---------------------------------------------------------------------------
# AgentCore Memory — cross-turn session state (short-term/raw events)
# ---------------------------------------------------------------------------
resource "aws_bedrockagentcore_memory" "chat" {
  # Memory names allow letters/digits/underscores only — no hyphens.
  name                  = "${replace(local.name_prefix, "-", "_")}_chat_memory"
  description           = "Conversation memory for the chat agent"
  event_expiry_duration = 30
}

# ---------------------------------------------------------------------------
# AgentCore runtime — points at the uploaded zip, Cognito JWT inbound auth
# ---------------------------------------------------------------------------
resource "aws_bedrockagentcore_agent_runtime" "chat_agent" {
  agent_runtime_name = "${replace(local.name_prefix, "-", "_")}_chat_agent" # letters/digits/underscores only — no hyphens
  role_arn           = aws_iam_role.agent_runtime.arn

  agent_runtime_artifact {
    code_configuration {
      runtime = "PYTHON_3_12"
      # OTel auto-instrumentation: opentelemetry-instrument wraps main.py so the
      # agent emits traces/metrics to AgentCore observability. Requires the
      # aws-opentelemetry-distro dep (apps/ai/agents/chat/requirements.txt).
      entry_point = ["opentelemetry-instrument", "main.py"]

      code {
        s3 {
          bucket = aws_s3_bucket.agent_artifacts.id
          prefix = aws_s3_object.agent_zip.key
        }
      }
    }
  }

  network_configuration {
    network_mode = "PUBLIC"
  }

  # Cognito JWT inbound authorizer — reuses the pool/client from backend_auth.tf.
  # The browser sends a Cognito access token as a Bearer token; AgentCore
  # validates it against the pool's OIDC discovery document.
  authorizer_configuration {
    custom_jwt_authorizer {
      discovery_url   = "https://cognito-idp.${local.region}.amazonaws.com/${aws_cognito_user_pool.this.id}/.well-known/openid-configuration"
      allowed_clients = [aws_cognito_user_pool_client.this.id]
    }
  }

  # CODE_VERSION busts AgentCore's S3-zip cache on a code change; MEMORY_ID
  # tells the agent which Terraform-managed memory to use (also creates the
  # dependency edge); GATEWAY_URL is the MCP endpoint the agent connects to for
  # tools (ai_gateway.tf). Bedrock is invoked directly with this runtime's
  # execution role; the runtime injects AWS_REGION automatically.
  environment_variables = {
    CODE_VERSION = local.agent_source_code_hash
    MEMORY_ID    = aws_bedrockagentcore_memory.chat.id
    GATEWAY_URL  = aws_bedrockagentcore_gateway.this.gateway_url
    # AgentCore Identity (M2M) outbound auth to the gateway: the credential
    # provider name the agent passes to @requires_access_token, and the OAuth2
    # scopes to request. The agent mints its OWN gateway token — no user-token
    # replay (apps/ai/agents/chat/main.py `gateway_access_token`).
    GATEWAY_CREDENTIAL_PROVIDER = aws_bedrockagentcore_oauth2_credential_provider.gateway.name
    GATEWAY_SCOPES              = join(" ", aws_cognito_resource_server.gateway.scope_identifiers) # "gateway/invoke"
    # SSM path the orchestrator reads to auto-discover the A2A subagent fleet. Each
    # subagent registers one parameter under here (see the number_specialist section
    # below). Intentionally NOT a depends_on — adding a subagent must not redeploy chat.
    SUBAGENT_REGISTRY_PATH = "/${local.name_prefix}/a2a-subagents"
  }

  # IAM is eventually consistent — make sure the role + policy exist first.
  depends_on = [aws_iam_role_policy.agent_permissions]
}

# ===========================================================================
# A2A subagent fleet — member #1: number_specialist
# ===========================================================================
# Like the chat agent, this subagent ships as a zip "direct code deployment"
# (ARM64 deps + sources zipped by build_agent.sh, uploaded to the shared
# artifacts bucket, pulled by the runtime via code_configuration) rather than a
# container — while keeping protocol_configuration { server_protocol = "A2A" }.
# AgentCore runs main.py, which starts serve_a2a on 0.0.0.0:9000. Each subagent
# is a self-contained unit:
#   { source_hash → zip upload → A2A runtime → IAM role → SSM registry entry }.
# The orchestrator auto-discovers it from the SSM registry at request time, so
# adding subagent #2 means copying this block (new name) — no chat-agent change.
#
# Reuses the chat agent's trust policy (data.aws_iam_policy_document.agent_trust),
# the shared artifacts bucket (aws_s3_bucket.agent_artifacts), and the shared
# Cognito pool + MCP gateway. Auth splits by direction: INBOUND (chat → subagent
# A2A call) is validated at this runtime's front-door Cognito JWT authorizer using
# the user's token; OUTBOUND (subagent → gateway MCP call) uses the subagent's OWN
# AgentCore Identity M2M token — no user-token replay.

locals {
  # Hash of the subagent's zip inputs (same shape as the chat agent's
  # agent_source_code_hash). Drives the build trigger, the hash-named S3 key, and
  # CODE_VERSION (cache-bust): a code change yields a new key + env value, so the
  # runtime pulls a fresh zip. All inputs exist at plan time.
  subagent_source_hash = sha1(join("", [
    filesha256("${path.module}/../../apps/ai/agents/number_specialist/main.py"),
    filesha256("${path.module}/../../apps/ai/agents/number_specialist/requirements.txt"),
    filesha256("${path.module}/../../apps/ai/agents/build_agent.sh"),
  ]))

  subagent_zip_path = "${path.module}/../../apps/ai/agents/number_specialist/build/agent.zip"
}

# ---------------------------------------------------------------------------
# Build the ARM64 zip — only when the subagent's sources change
# ---------------------------------------------------------------------------
resource "terraform_data" "subagent_build" {
  triggers_replace = local.subagent_source_hash

  # Same reusable zip builder the chat agent uses (aarch64 cp312 wheels).
  provisioner "local-exec" {
    command     = "./build_agent.sh number_specialist"
    working_dir = "${path.module}/../../apps/ai/agents"
  }
}

# ---------------------------------------------------------------------------
# Upload the zip to the shared artifacts bucket — hashed key busts the cache
# ---------------------------------------------------------------------------
resource "aws_s3_object" "subagent_zip" {
  bucket      = aws_s3_bucket.agent_artifacts.id
  key         = "number_specialist/${local.subagent_source_hash}.zip"
  source      = local.subagent_zip_path
  source_hash = local.subagent_source_hash

  depends_on = [terraform_data.subagent_build]
}

# ---------------------------------------------------------------------------
# Subagent execution role — trust reused from the chat agent (confused-deputy
# guarded). Policy mirrors the chat role MINUS AgentCore Memory and the subagent
# registry read (it's stateless and discovers no one), but keeps the same S3
# ReadArtifacts grant to pull its code_configuration zip.
# ---------------------------------------------------------------------------
resource "aws_iam_role" "subagent_runtime" {
  name               = "${local.name_prefix}-number-specialist-runtime"
  assume_role_policy = data.aws_iam_policy_document.agent_trust.json
}

data "aws_iam_policy_document" "subagent_permissions" {
  # Invoke any Bedrock foundation model / inference profile directly in this account
  # (apps/ai/agents/number_specialist/main.py `build_agent` builds BedrockModel with the
  # runtime's execution-role credentials). Same any-region scope as the chat role,
  # required for `global.` cross-region inference profiles.
  statement {
    sid = "InvokeModel"

    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]

    resources = [
      "arn:aws:bedrock:*::foundation-model/*",
      "arn:aws:bedrock:*:${data.aws_caller_identity.current.account_id}:inference-profile/*",
    ]
  }

  # Bedrock Marketplace auto-subscription on first Anthropic invocation (no resource scoping).
  statement {
    sid = "BedrockMarketplaceSubscription"

    actions = [
      "aws-marketplace:Subscribe",
      "aws-marketplace:ViewSubscriptions",
    ]

    resources = ["*"]
  }

  # Read the agent zip from the shared artifacts bucket (same as the chat role).
  # AgentCore assumes this execution role to pull the code_configuration zip.
  statement {
    sid       = "ReadArtifacts"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.agent_artifacts.arn}/*"]
  }

  # Write runtime logs.
  statement {
    sid = "Logs"

    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
      "logs:DescribeLogGroups",
    ]

    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/bedrock-agentcore/*"]
  }

  # Workload identity token required by the AgentCore runtime contract.
  statement {
    sid = "WorkloadIdentity"

    actions = [
      "bedrock-agentcore:GetWorkloadAccessToken",
      "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
      "bedrock-agentcore:GetWorkloadAccessTokenForUserId",
    ]

    resources = ["*"]
  }

  # Mint the subagent's OWN gateway token via AgentCore Identity (M2M) instead of
  # reading a forwarded user token. Same ["*"] grant as the chat role — the action
  # authorizes against a chain of dynamic AgentCore Identity ARNs that don't scope
  # cleanly (see the chat role's GatewayOauth2Token comment).
  statement {
    sid       = "GatewayOauth2Token"
    actions   = ["bedrock-agentcore:GetResourceOauth2Token"]
    resources = ["*"]
  }

  # Same as the chat role: AgentCore Identity reads the vaulted M2M client secret
  # under this role's identity while serving GetResourceOauth2Token. Same provider,
  # same reserved secret name → identical grant.
  statement {
    sid       = "ReadGatewayM2MSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["arn:aws:secretsmanager:${local.region}:${data.aws_caller_identity.current.account_id}:secret:bedrock-agentcore-identity!default/oauth2/${aws_bedrockagentcore_oauth2_credential_provider.gateway.name}-*"]
  }
}

resource "aws_iam_role_policy" "subagent_permissions" {
  name   = "${local.name_prefix}-number-specialist-permissions"
  role   = aws_iam_role.subagent_runtime.id
  policy = data.aws_iam_policy_document.subagent_permissions.json
}

# ---------------------------------------------------------------------------
# A2A runtime — zip code artifact, A2A protocol, Cognito JWT inbound auth
# ---------------------------------------------------------------------------
resource "aws_bedrockagentcore_agent_runtime" "number_specialist" {
  agent_runtime_name = "${replace(local.name_prefix, "-", "_")}_number_specialist" # underscores only
  role_arn           = aws_iam_role.subagent_runtime.arn

  agent_runtime_artifact {
    code_configuration {
      runtime     = "PYTHON_3_12"
      entry_point = ["main.py"] # MUST match the zip-root file (build_agent.sh copies sources to root)

      code {
        s3 {
          bucket = aws_s3_bucket.agent_artifacts.id
          prefix = aws_s3_object.subagent_zip.key
        }
      }
    }
  }

  network_configuration {
    network_mode = "PUBLIC"
  }

  # A2A server protocol — exposes /.well-known/agent-card.json + JSON-RPC at `/`.
  protocol_configuration {
    server_protocol = "A2A"
  }

  # Inbound A2A auth: the chat orchestrator calls this runtime with the user's
  # Cognito token, validated here against the same pool/client as the chat
  # runtime. This is front-door (inbound) auth only — the subagent reaches the
  # gateway with its own M2M token, NOT this forwarded token.
  authorizer_configuration {
    custom_jwt_authorizer {
      discovery_url   = "https://cognito-idp.${local.region}.amazonaws.com/${aws_cognito_user_pool.this.id}/.well-known/openid-configuration"
      allowed_clients = [aws_cognito_user_pool_client.this.id]
    }
  }

  # CODE_VERSION busts AgentCore's S3-zip cache on a code change (same as the chat
  # agent). DOCKER_CONTAINER=1 forces serve_a2a to bind 0.0.0.0 in this container-less
  # direct code deployment (it otherwise only binds 0.0.0.0 when it detects a
  # container). GATEWAY_URL is reused verbatim from the chat agent; Bedrock is invoked
  # directly with this runtime's execution role. Do NOT set AGENTCORE_RUNTIME_URL —
  # AgentCore Runtime injects it at runtime and serve_a2a uses it to advertise the real
  # invocation URL in the agent card (and a runtime can't self-reference its own ARN at
  # creation anyway).
  environment_variables = {
    CODE_VERSION     = local.subagent_source_hash
    DOCKER_CONTAINER = "1"
    GATEWAY_URL      = aws_bedrockagentcore_gateway.this.gateway_url
    # AgentCore Identity (M2M) outbound auth to the gateway — same credential
    # provider + scopes as the chat agent. The subagent mints its OWN gateway
    # token keyed off the injected WorkloadAccessToken; no forwarded user token
    # (apps/ai/agents/number_specialist/main.py `gateway_access_token`).
    GATEWAY_CREDENTIAL_PROVIDER = aws_bedrockagentcore_oauth2_credential_provider.gateway.name
    GATEWAY_SCOPES              = join(" ", aws_cognito_resource_server.gateway.scope_identifiers) # "gateway/invoke"
  }

  depends_on = [
    terraform_data.subagent_build,
    aws_iam_role_policy.subagent_permissions,
  ]
}

# ---------------------------------------------------------------------------
# Registry entry — the single registration point the orchestrator discovers.
# Adding a subagent = a new runtime + one parameter like this. Value = runtime ARN.
# ---------------------------------------------------------------------------
resource "aws_ssm_parameter" "number_specialist_registry" {
  name  = "/${local.name_prefix}/a2a-subagents/number_specialist"
  type  = "String"
  value = aws_bedrockagentcore_agent_runtime.number_specialist.agent_runtime_arn
}
