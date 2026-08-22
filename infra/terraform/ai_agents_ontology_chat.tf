# Asking questions of a finished ontology — a second Claude Agent SDK agent on an
# AgentCore container runtime, separate from the build agent that produced it.
# Mirrors the CDK OntologyChatAgent construct
# (infra/cdk/lib/constructs/ai/agents/OntologyChatAgent.ts).
#
# It walks pages rather than searching them. A plain vector search cannot answer a
# question whose answer is split across documents that never mention each other; the
# graph can, because both documents touch a node they share. The five tools it holds
# are primitives (search, read a page, list a page's relations, take one hop, describe
# the corpus) and the n-hop walk is assembled from them by subagents the orchestrator
# dispatches — which is what makes the depth a decision rather than a constant, and
# keeps the pages a search reads out of the orchestrator's context.
#
# Nothing in this file registers a tool. The tools are in-process MCP servers inside
# the runtime, so there is no gateway target, no tool Lambda, and no REST route: the
# whole flow runs on the caller's own Claude subscription.
#
# Unlike the build runtime, this one HAS an authorizer_configuration, because the
# browser invokes it directly with a Cognito access token and reads the answer back
# over SSE. The verified sub off that token is what every read path derives from —
# which is why the request_header_configuration below is part of the auth story rather
# than a tuning knob: the authorizer consumes the header, and only the allowlist puts
# it back in front of the agent.

locals {
  ontology_chat_dir = "${path.module}/../../apps/ai/agents/ontology_chat"

  ontology_chat_files = sort([
    for f in fileset(local.ontology_chat_dir, "**/*") :
    "${local.ontology_chat_dir}/${f}" if !strcontains(f, "__pycache__")
  ])
  ontology_chat_source_hash = sha1(join("", [
    for f in local.ontology_chat_files : filesha256(f)
  ]))
  ontology_chat_image_uri = "${aws_ecr_repository.ontology_chat.repository_url}:${local.ontology_chat_source_hash}"
}

# ===========================================================================
# Container image — ARM64, built and pushed by the shared agent build script
# ===========================================================================
resource "aws_ecr_repository" "ontology_chat" {
  name                 = "${local.name_prefix}-ontology-chat"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

resource "terraform_data" "ontology_chat_build" {
  # Rebuild+push when the agent source changes (hash), the ECR image is missing
  # (self-healing guard), or the shared build helper changes.
  triggers_replace = [
    local.ontology_chat_source_hash,
    data.external.ecr_image["ontology_chat"].result.present,
    filesha256("${path.module}/../../scripts/build_container_image.sh"),
    filesha256("${path.module}/../../apps/ai/agents/build_agent_container.sh"),
  ]

  provisioner "local-exec" {
    command = "${path.module}/../../apps/ai/agents/build_agent_container.sh ontology_chat ${aws_ecr_repository.ontology_chat.repository_url} ${local.ontology_chat_source_hash} ${local.region}"
  }

  depends_on = [aws_ecr_repository.ontology_chat]
}

# ===========================================================================
# Runtime execution role
# ===========================================================================
resource "aws_iam_role" "ontology_chat_runtime" {
  name = "${local.name_prefix}-ontology-chat-runtime"
  # Reuses the chat agent's trust policy (ai_agents.tf) — service
  # bedrock-agentcore.amazonaws.com with the confused-deputy conditions.
  assume_role_policy = data.aws_iam_policy_document.agent_trust.json
}

data "aws_iam_policy_document" "ontology_chat_permissions" {
  statement {
    sid     = "Logs"
    actions = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = [
      "arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/bedrock-agentcore/*",
      "arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/bedrock-agentcore/*:log-stream:*",
    ]
  }

  statement {
    sid       = "WorkloadIdentity"
    actions   = ["bedrock-agentcore:GetWorkloadAccessToken", "bedrock-agentcore:GetWorkloadAccessTokenForJWT", "bedrock-agentcore:GetWorkloadAccessTokenForUserId"]
    resources = ["*"]
  }

  statement {
    sid       = "EcrPull"
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
    resources = [aws_ecr_repository.ontology_chat.arn]
  }

  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # The caller's own Claude token — the only credential the agent's model calls use.
  statement {
    sid       = "ReadClaudeTokens"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [aws_secretsmanager_secret.claude_user_tokens.arn]
  }

  # Read-only over the lake. A question can never write to a build, so gold is granted
  # read and nothing else; tenancy inside the bucket is enforced in the handlers from
  # the verified sub.
  statement {
    sid       = "GoldRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.datalake_gold.arn}/users/*"]
  }

  statement {
    sid       = "LakeList"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.datalake_gold.arn]
  }

  # Ownership check before any prefix is derived from a build id.
  statement {
    sid       = "JobTableRead"
    actions   = ["dynamodb:GetItem", "dynamodb:DescribeTable"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }

  # Query the page index. PutVectors belongs to the hydrate Lambda, not here.
  # GetVectors is what authorizes the metadata coming back: QueryVectors alone permits
  # the query but not `returnMetadata`, and every hit is keyed off the pageId held
  # there, so without it the search returns AccessDenied.
  statement {
    sid     = "QueryPageVectors"
    actions = ["s3vectors:QueryVectors", "s3vectors:GetVectors", "s3vectors:GetIndex"]
    resources = [
      aws_s3vectors_vector_bucket.ontology_vectors.vector_bucket_arn,
      aws_s3vectors_index.ontology_vectors.index_arn,
    ]
  }

  # Embeddings ONLY. Text generation runs on the caller's Claude subscription, so this
  # role holds no general Bedrock model access; the query still has to be embedded with
  # the same model the index was written with.
  statement {
    sid       = "InvokeTitanEmbeddings"
    actions   = ["bedrock:InvokeModel"]
    resources = [local.ontology_embed_model_arn]
  }

  # Write a turn, read the conversation back. Two actions, not the chat agent's seven:
  # this runtime never lists sessions (the picker's Lambda does) and has no strategies
  # to retrieve records from.
  statement {
    sid     = "AgentCoreMemory"
    actions = ["bedrock-agentcore:CreateEvent", "bedrock-agentcore:ListEvents"]
    resources = [
      aws_bedrockagentcore_memory.ontology_chat.arn,
      "${aws_bedrockagentcore_memory.ontology_chat.arn}/*",
    ]
  }
}

# ===========================================================================
# AgentCore Memory — short-term raw events, no strategies, so a turn comes back
# exactly as it was written.
#
# Its own memory rather than the chat agent's (ai_agents.tf): that one holds
# serialized Strands envelopes its replay endpoint has to reverse-engineer, and
# these events are plain text. One reader per store, and neither has to guess.
# ===========================================================================
resource "aws_bedrockagentcore_memory" "ontology_chat" {
  # Memory names allow letters/digits/underscores only — no hyphens — and are
  # length-capped, hence the abbreviated form.
  name                  = "${replace(local.name_prefix, "-", "_")}_onto_chat_memory"
  description           = "Conversation memory for the ontology chat agent"
  event_expiry_duration = 30
}

resource "aws_iam_role_policy" "ontology_chat_permissions" {
  name   = "${local.name_prefix}-ontology-chat-policy"
  role   = aws_iam_role.ontology_chat_runtime.id
  policy = data.aws_iam_policy_document.ontology_chat_permissions.json
}

# ===========================================================================
# The runtime itself
# ===========================================================================
resource "aws_bedrockagentcore_agent_runtime" "ontology_chat" {
  agent_runtime_name = "${replace(local.name_prefix, "-", "_")}_ontology_chat_agent" # underscores only
  role_arn           = aws_iam_role.ontology_chat_runtime.arn
  description        = "Claude Agent SDK ontology retrieval (orchestrator + seeker + explorer)"

  agent_runtime_artifact {
    container_configuration {
      container_uri = local.ontology_chat_image_uri
    }
  }

  network_configuration {
    network_mode = "PUBLIC"
  }

  # Cognito JWT inbound authorizer — reuses the pool/client from backend_auth.tf.
  # The browser sends a Cognito access token as a Bearer token; AgentCore validates
  # it against the pool's OIDC discovery document, and the agent reads the caller's
  # sub off that already-verified token.
  authorizer_configuration {
    custom_jwt_authorizer {
      discovery_url   = "https://cognito-idp.${local.region}.amazonaws.com/${aws_cognito_user_pool.this.id}/.well-known/openid-configuration"
      allowed_clients = [aws_cognito_user_pool_client.this.id]
    }
  }

  # Load-bearing, not decoration. The authorizer above consumes Authorization at the
  # front door, and AgentCore forwards it into the container only when the runtime
  # allowlists it; without this the agent sees no token and refuses every question.
  request_header_configuration {
    request_header_allowlist = ["Authorization"]
  }

  environment_variables = {
    JOB_TABLE            = aws_dynamodb_table.ontology_jobs.name
    CLAUDE_TOKENS_SECRET = aws_secretsmanager_secret.claude_user_tokens.arn
    GOLD_BUCKET_NAME     = aws_s3_bucket.datalake_gold.id
    VECTOR_BUCKET        = aws_s3vectors_vector_bucket.ontology_vectors.vector_bucket_name
    VECTOR_INDEX         = aws_s3vectors_index.ontology_vectors.index_name
    MEMORY_ID            = aws_bedrockagentcore_memory.ontology_chat.id
  }

  depends_on = [
    terraform_data.ontology_chat_build,
    aws_iam_role_policy.ontology_chat_permissions,
  ]
}
