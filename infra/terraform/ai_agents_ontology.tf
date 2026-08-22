# The ontology build: a Step Functions state machine that owns every deterministic
# stage, calling out to one Claude Agent SDK runtime on AgentCore for the two stages
# that need a model. Mirrors the CDK OntologyAgent and OntologyVectorStore constructs
# (infra/cdk/lib/constructs/ai/agents/OntologyAgent.ts,
# infra/cdk/lib/constructs/ai/tools/OntologyVectorStore.ts). The retrieval runtime
# that answers questions about a finished build lives in ai_agents_ontology_chat.tf.
#
# The state machine converts each document, segments the markdown into pages, fans
# EXTRACT out one Distributed Map branch per batch of pages, compacts the result, hands
# CONSOLIDATE to the runtime, then canonicalizes and emits in Lambdas — all while the
# page index hydrates on a second branch. Every fan-out is DISTRIBUTED so a branch's
# polling stays in a child execution rather than in the parent's 25,000-event history.
#
# EXTRACT is the whole reason this shape exists: it is one model call per page and it
# is embarrassingly parallel, so its concurrency belongs to infrastructure. CANONICALIZE
# and EMIT make no model calls at all and are plain Lambdas, which leaves CONSOLIDATE as
# the only stage a model decides anything in.
#
#   POST /ontology/build                 -> ontology_start   -> row + StartExecution
#     convert state machine (Map over documents) -> ontology_segment
#       -> { ontology_plan_extract -> Map(ontology_extract_pages -> InvokeAgentRuntime)
#            -> ontology_compact_elements -> ontology_start_agent -> poll agentStatus
#            -> ontology_canonicalize -> ontology_emit
#          , ontology_hydrate_index (Map over the page manifest) }
#   GET  /ontology/status                -> ontology_status  -> reads the job row
#   GET  /ontology/builds                -> ontology_list    -> by_owner + by_visibility
#   GET  /ontology/builds/{jobId}/outputs-> ontology_outputs -> presigns gold
# The API routes + invoke permissions live in backend_api.tf; this file owns the
# runtime, the state machine, the job table, the page index, and the control Lambdas.
#
# The runtime is a CONTAINER, not a zip: claude-agent-sdk shells out to a ~244 MB
# `claude` CLI the image must carry, which the zip ceiling cannot hold. It is the
# first container runtime this tree deploys, so it follows the container unit
# documented for A2A subagents: { source_hash -> ECR repo -> terraform_data build ->
# runtime -> IAM role }, hash-tagged (never :latest) so a changed image yields a new
# immutable URI that busts AgentCore's cache.
#
# There is deliberately NO authorizer_configuration: the browser never calls this
# runtime. The start-agent and extract-pages Lambdas invoke it over SigV4, so
# bedrock-agentcore:InvokeAgentRuntime on those two roles is the entire authorization
# story.

locals {
  ontology_agent_dir = "${path.module}/../../apps/ai/agents/ontology"

  # Deterministic references to the converter (owned by backend_converter.tf) — using
  # the physical name/ARN keeps this parity-free of an ordering dependency.
  converter_trigger_name = "${local.name_prefix}-converter-trigger"
  converter_jobs_name    = "${local.name_prefix}-converter-jobs"
  converter_trigger_arn  = "arn:aws:lambda:${local.region}:${data.aws_caller_identity.current.account_id}:function:${local.converter_trigger_name}"
  converter_jobs_arn     = "arn:aws:dynamodb:${local.region}:${data.aws_caller_identity.current.account_id}:table/${local.converter_jobs_name}"

  # Titan v2 is the ONLY model this runtime may invoke. Text generation runs on the
  # caller's Claude subscription, so the absence of general model access is the point.
  ontology_embed_model_arn = "arn:aws:bedrock:${local.region}::foundation-model/amazon.titan-embed-text-v2:0"

  ontology_agent_files = sort([
    for f in fileset(local.ontology_agent_dir, "**/*") :
    "${local.ontology_agent_dir}/${f}" if !strcontains(f, "__pycache__")
  ])
  ontology_agent_source_hash = sha1(join("", [
    for f in local.ontology_agent_files : filesha256(f)
  ]))
  ontology_agent_image_uri = "${aws_ecr_repository.ontology_agent.repository_url}:${local.ontology_agent_source_hash}"

  ontology_vector_bucket_name = "${local.name_prefix}-ontology-vectors"
  ontology_vector_index_name  = "ontology-pages"

  # Built, not referenced. A Distributed Map's role needs permission on the state
  # machine that owns the Map, and the state machine already depends_on that policy —
  # referencing the resource would close a cycle.
  ontology_convert_sfn_name      = "${local.name_prefix}-ontology-convert"
  ontology_convert_sfn_arn       = "arn:aws:states:${local.region}:${data.aws_caller_identity.current.account_id}:stateMachine:${local.ontology_convert_sfn_name}"
  ontology_convert_execution_arn = "arn:aws:states:${local.region}:${data.aws_caller_identity.current.account_id}:execution:${local.ontology_convert_sfn_name}/*"
}

# ---------------------------------------------------------------------------
# Page index — Amazon S3 Vectors, written directly rather than through a
# Bedrock Knowledge Base.
# ---------------------------------------------------------------------------
# No KB, deliberately. A KB owns its own chunking, so its chunk ids would not map
# to the chunk ids in nodes.csv and the node-to-chunk join would break; it ingests
# asynchronously, so a finished build would not be searchable until an ingestion
# job it does not control had run; and one job per data source means concurrent
# builds contend. Writing vectors directly costs a PutVectors call and removes all
# three problems.
#
# One index for every build in the stage. A query filters on buildId, and the
# vector keys carry it too, so two builds over the same corpus (which produce the
# same page ids) cannot collide.
resource "aws_s3vectors_vector_bucket" "ontology_vectors" {
  vector_bucket_name = local.ontology_vector_bucket_name
}

resource "aws_s3vectors_index" "ontology_vectors" {
  vector_bucket_name = aws_s3vectors_vector_bucket.ontology_vectors.vector_bucket_name
  index_name         = local.ontology_vector_index_name
  data_type          = "float32"
  dimension          = 1024 # must match the embedding model (Titan Text Embeddings v2)
  distance_metric    = "cosine"

  metadata_configuration {
    # Everything a query filters on (buildId, userSub, pageId, docId) stays
    # FILTERABLE by omission. The window text and the document title are payload
    # the caller reads off the hit, never predicates.
    non_filterable_metadata_keys = ["text", "docTitle"]
  }
}

# ---------------------------------------------------------------------------
# Job table — one row per build (status, coarse stage, live extraction counter,
# gold outputs, activity trail). No TTL: a succeeded ontology has to stay
# retrievable, and by_owner is what the saved-ontologies panel queries.
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "ontology_jobs" {
  name         = "${local.name_prefix}-ontology-jobs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "jobId"

  attribute {
    name = "jobId"
    type = "S"
  }

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "N"
  }

  attribute {
    name = "visibility"
    type = "S"
  }

  attribute {
    name = "publishedAt"
    type = "N"
  }

  global_secondary_index {
    name            = "by_owner"
    hash_key        = "userId"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  # Published ontologies, newest first. Deliberately sparse: a private build has
  # neither key attribute set, so it is not in the index at all and the library's
  # "shared" query reads exactly the rows it is allowed to see rather than filtering
  # the whole table. Publishing sets both attributes and unpublishing removes them.
  #
  # One partition key value means one partition, which is fine for a read-mostly
  # index and is the thing to revisit if publishing becomes the default.
  global_secondary_index {
    name            = "by_visibility"
    hash_key        = "visibility"
    range_key       = "publishedAt"
    projection_type = "ALL"
  }
}

# ===========================================================================
# Container image — ARM64, built and pushed by the shared agent build script
# ===========================================================================
resource "aws_ecr_repository" "ontology_agent" {
  name                 = "${local.name_prefix}-ontology-agent"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

resource "terraform_data" "ontology_agent_build" {
  # Rebuild+push when the agent source changes (hash), the ECR image is missing
  # (self-healing guard), or the shared build helper changes.
  triggers_replace = [
    local.ontology_agent_source_hash,
    data.external.ecr_image["ontology_agent"].result.present,
    filesha256("${path.module}/../../scripts/build_container_image.sh"),
    filesha256("${path.module}/../../apps/ai/agents/build_agent_container.sh"),
  ]

  provisioner "local-exec" {
    command = "${path.module}/../../apps/ai/agents/build_agent_container.sh ontology ${aws_ecr_repository.ontology_agent.repository_url} ${local.ontology_agent_source_hash} ${local.region}"
  }

  depends_on = [aws_ecr_repository.ontology_agent]
}

# ===========================================================================
# Runtime execution role
# ===========================================================================
resource "aws_iam_role" "ontology_agent_runtime" {
  name = "${local.name_prefix}-ontology-agent-runtime"
  # Reuses the chat agent's trust policy (ai_agents.tf) — service
  # bedrock-agentcore.amazonaws.com with the confused-deputy conditions.
  assume_role_policy = data.aws_iam_policy_document.agent_trust.json
}

data "aws_iam_policy_document" "ontology_agent_permissions" {
  statement {
    sid     = "Logs"
    actions = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = [
      "arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/bedrock-agentcore/*",
      "arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/bedrock-agentcore/*:log-stream:*",
    ]
  }

  # AgentCore injects a workload access token the runtime exchanges for its identity.
  statement {
    sid       = "WorkloadIdentity"
    actions   = ["bedrock-agentcore:GetWorkloadAccessToken", "bedrock-agentcore:GetWorkloadAccessTokenForJWT", "bedrock-agentcore:GetWorkloadAccessTokenForUserId"]
    resources = ["*"]
  }

  # AgentCore pulls the image with this role.
  statement {
    sid       = "EcrPull"
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
    resources = [aws_ecr_repository.ontology_agent.arn]
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

  # The agent starts after conversion, so it never touches bronze: it reads the
  # markdown in silver and writes its artifacts to gold. Tenancy is enforced in the
  # handlers from the verified sub, so these are scoped per bucket to the users/ tree.
  statement {
    sid       = "SilverRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.datalake_silver.arn}/users/*"]
  }

  statement {
    sid       = "GoldReadWrite"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"]
    resources = ["${aws_s3_bucket.datalake_gold.arn}/users/*"]
  }

  statement {
    sid     = "LakeList"
    actions = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [
      aws_s3_bucket.datalake_silver.arn,
      aws_s3_bucket.datalake_gold.arn,
    ]
  }

  statement {
    sid = "JobTableReadWrite"
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
      "dynamodb:Query", "dynamodb:DescribeTable",
    ]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }

  # Embeddings ONLY. Deliberately narrower than this tree's other Bedrock statements,
  # which allow any foundation model: pinning the model id is what makes "no text
  # generation on the app's account" an IAM fact rather than a convention. No
  # marketplace-subscription statement follows, because Titan needs none.
  statement {
    sid       = "InvokeTitanEmbeddings"
    actions   = ["bedrock:InvokeModel"]
    resources = [local.ontology_embed_model_arn]
  }
}

resource "aws_iam_role_policy" "ontology_agent_permissions" {
  name   = "${local.name_prefix}-ontology-agent-policy"
  role   = aws_iam_role.ontology_agent_runtime.id
  policy = data.aws_iam_policy_document.ontology_agent_permissions.json
}

# ===========================================================================
# The runtime itself
# ===========================================================================
resource "aws_bedrockagentcore_agent_runtime" "ontology_agent" {
  agent_runtime_name = "${replace(local.name_prefix, "-", "_")}_ontology_agent" # underscores only
  role_arn           = aws_iam_role.ontology_agent_runtime.arn
  description        = "Claude Agent SDK ontology build (orchestrator + four stage subagents)"

  agent_runtime_artifact {
    container_configuration {
      container_uri = local.ontology_agent_image_uri
    }
  }

  network_configuration {
    network_mode = "PUBLIC"
  }

  # No protocol_configuration: this is an HTTP runtime (the default), not A2A.
  # No authorizer_configuration: inbound auth is IAM, and only the start-agent
  # Lambda's role carries InvokeAgentRuntime.

  environment_variables = {
    JOB_TABLE            = aws_dynamodb_table.ontology_jobs.name
    CLAUDE_TOKENS_SECRET = aws_secretsmanager_secret.claude_user_tokens.arn
    SILVER_BUCKET_NAME   = aws_s3_bucket.datalake_silver.id
    GOLD_BUCKET_NAME     = aws_s3_bucket.datalake_gold.id
  }

  depends_on = [
    terraform_data.ontology_agent_build,
    aws_iam_role_policy.ontology_agent_permissions,
  ]
}

# ===========================================================================
# Control plane — zipped from the agent dir so the shared/ package is importable
# ===========================================================================
data "archive_file" "ontology_control" {
  type        = "zip"
  source_dir  = local.ontology_agent_dir
  output_path = "${path.module}/build/ontology_control.zip"
  # Mirrors the CDK asset's exclude list — the control Lambdas need control/ and
  # shared/, never the agent's in-process tool servers or its image build files.
  excludes = ["tools/**", "statemachine/**", "Dockerfile", ".dockerignore", "requirements.txt", "**/__pycache__/**", "**/*.pyc"]
}

# --- ontology_carry_forward — the state machine's first stage --------------
# A no-op for an ordinary build. For a corpus update it copies each kept document's
# bronze object, converted markdown and extracted elements out of the source build's
# prefixes into this build's, so Convert runs only over the documents that were added
# and PlanExtract leaves the carried pages out of the extraction fan-out.
# Not an API endpoint: Step Functions is its only caller.
resource "aws_iam_role" "ontology_carry_forward_exec" {
  name               = "${local.name_prefix}-ontology-carry-forward-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_carry_forward_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "JobRow"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }

  # Both sides of every copy. CopyObject reads the source and writes the target, both
  # in the same bucket. The target is always the caller's own prefix; the source is
  # another user's when this build is a new version of a published ontology, which is
  # why these are scoped to users/* rather than to one sub.
  statement {
    sid     = "LakeObjects"
    actions = ["s3:GetObject", "s3:PutObject"]
    resources = [
      "${aws_s3_bucket.datalake_bronze.arn}/users/*",
      "${aws_s3_bucket.datalake_silver.arn}/users/*",
      "${aws_s3_bucket.datalake_gold.arn}/users/*",
    ]
  }

  statement {
    sid     = "LakeList"
    actions = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [
      aws_s3_bucket.datalake_bronze.arn,
      aws_s3_bucket.datalake_silver.arn,
      aws_s3_bucket.datalake_gold.arn,
    ]
  }
}

resource "aws_iam_role_policy" "ontology_carry_forward_permissions" {
  name   = "${local.name_prefix}-ontology-carry-forward-policy"
  role   = aws_iam_role.ontology_carry_forward_exec.id
  policy = data.aws_iam_policy_document.ontology_carry_forward_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_carry_forward" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-carry-forward"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_carry_forward" {
  function_name    = "${local.name_prefix}-ontology-carry-forward"
  runtime          = "python3.12"
  handler          = "control.carry_forward.lambda_handler"
  filename         = data.archive_file.ontology_control.output_path
  source_code_hash = data.archive_file.ontology_control.output_base64sha256
  role             = aws_iam_role.ontology_carry_forward_exec.arn
  # One round trip per carried object, and a large corpus carries thousands of them.
  # The copies themselves are server side, so this is latency rather than throughput.
  timeout     = 900
  memory_size = 1024
  layers      = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE          = aws_dynamodb_table.ontology_jobs.name
      BRONZE_BUCKET_NAME = aws_s3_bucket.datalake_bronze.id
      SILVER_BUCKET_NAME = aws_s3_bucket.datalake_silver.id
      GOLD_BUCKET_NAME   = aws_s3_bucket.datalake_gold.id
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_carry_forward_permissions,
    aws_cloudwatch_log_group.ontology_carry_forward,
  ]
}

# --- ontology_segment — the state machine's fan-in -------------------------
# Turns the Convert Map's per-document results into the markdown that exists plus
# the documents that never will, then cuts that markdown into pages and chunks under
# the build's gold prefix. Wholly deterministic, which is why it is a Lambda and not
# an agent role, and why it runs once before the two branches that both read pages.
# Not an API endpoint: Step Functions is its only caller.
resource "aws_iam_role" "ontology_segment_exec" {
  name               = "${local.name_prefix}-ontology-segment-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_segment_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "JobTableReadWrite"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }

  statement {
    sid       = "SilverRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.datalake_silver.arn}/users/*"]
  }

  statement {
    sid       = "GoldReadWrite"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.datalake_gold.arn}/users/*"]
  }

  statement {
    sid     = "LakeList"
    actions = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [
      aws_s3_bucket.datalake_silver.arn,
      aws_s3_bucket.datalake_gold.arn,
    ]
  }
}

resource "aws_iam_role_policy" "ontology_segment_permissions" {
  name   = "${local.name_prefix}-ontology-segment-policy"
  role   = aws_iam_role.ontology_segment_exec.id
  policy = data.aws_iam_policy_document.ontology_segment_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_segment" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-segment"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_segment" {
  function_name    = "${local.name_prefix}-ontology-segment"
  runtime          = "python3.12"
  handler          = "control.segment_build.lambda_handler"
  filename         = data.archive_file.ontology_control.output_path
  source_code_hash = data.archive_file.ontology_control.output_base64sha256
  role             = aws_iam_role.ontology_segment_exec.arn
  # Reads every converted markdown file, writes one object per page and streams two of
  # the build's flat outputs, so it needs far more than the control default of 30s.
  timeout     = 600
  memory_size = 2048
  layers      = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE        = aws_dynamodb_table.ontology_jobs.name
      GOLD_BUCKET_NAME = aws_s3_bucket.datalake_gold.id
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_segment_permissions,
    aws_cloudwatch_log_group.ontology_segment,
  ]
}

# --- ontology_hydrate_index — the concurrent branch ------------------------
# Embeds the build's pages into the shared S3 Vectors index, one invocation per
# batch of pages, while the agent builds the graph from the same pages. Three modes:
# hydrate a batch, mark the index ready, mark it failed. A hydration failure never
# fails the build — the graph is independently valid.
resource "aws_iam_role" "ontology_hydrate_index_exec" {
  name               = "${local.name_prefix}-ontology-hydrate-index-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_hydrate_index_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "JobTableReadWrite"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }

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

  statement {
    sid       = "InvokeTitanEmbeddings"
    actions   = ["bedrock:InvokeModel"]
    resources = [local.ontology_embed_model_arn]
  }

  statement {
    sid     = "WritePageVectors"
    actions = ["s3vectors:PutVectors"]
    resources = [
      aws_s3vectors_vector_bucket.ontology_vectors.vector_bucket_arn,
      aws_s3vectors_index.ontology_vectors.index_arn,
    ]
  }
}

resource "aws_iam_role_policy" "ontology_hydrate_index_permissions" {
  name   = "${local.name_prefix}-ontology-hydrate-index-policy"
  role   = aws_iam_role.ontology_hydrate_index_exec.id
  policy = data.aws_iam_policy_document.ontology_hydrate_index_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_hydrate_index" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-hydrate-index"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_hydrate_index" {
  function_name    = "${local.name_prefix}-ontology-hydrate-index"
  runtime          = "python3.12"
  handler          = "control.hydrate_index.lambda_handler"
  filename         = data.archive_file.ontology_control.output_path
  source_code_hash = data.archive_file.ontology_control.output_base64sha256
  role             = aws_iam_role.ontology_hydrate_index_exec.arn
  # Embedding is the slow part, hence the 15 minute ceiling.
  timeout     = 900
  memory_size = 2048
  layers      = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE        = aws_dynamodb_table.ontology_jobs.name
      GOLD_BUCKET_NAME = aws_s3_bucket.datalake_gold.id
      VECTOR_BUCKET    = aws_s3vectors_vector_bucket.ontology_vectors.vector_bucket_name
      VECTOR_INDEX     = aws_s3vectors_index.ontology_vectors.index_name
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_hydrate_index_permissions,
    aws_cloudwatch_log_group.ontology_hydrate_index,
  ]
}

# --- ontology_plan_extract — what still needs extracting -------------------
# Diffs the page manifest against the elements that exist and projects the difference
# where the extraction Map's ItemReader can stream it. Runs once before the fan-out
# and again after every pass, so one Map state serves both the initial extraction and
# every sweep. Not an API endpoint: Step Functions is its only caller.
resource "aws_iam_role" "ontology_plan_extract_exec" {
  name               = "${local.name_prefix}-ontology-plan-extract-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_plan_extract_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "JobTableReadWrite"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }

  statement {
    sid       = "GoldReadWrite"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.datalake_gold.arn}/users/*"]
  }

  # Required, not incidental: the diff lists the elements prefix.
  statement {
    sid       = "LakeList"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.datalake_gold.arn]
  }
}

resource "aws_iam_role_policy" "ontology_plan_extract_permissions" {
  name   = "${local.name_prefix}-ontology-plan-extract-policy"
  role   = aws_iam_role.ontology_plan_extract_exec.id
  policy = data.aws_iam_policy_document.ontology_plan_extract_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_plan_extract" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-plan-extract"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_plan_extract" {
  function_name    = "${local.name_prefix}-ontology-plan-extract"
  runtime          = "python3.12"
  handler          = "control.plan_extract.lambda_handler"
  filename         = data.archive_file.ontology_control.output_path
  source_code_hash = data.archive_file.ontology_control.output_base64sha256
  role             = aws_iam_role.ontology_plan_extract_exec.arn
  timeout          = 300
  memory_size      = 512
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE        = aws_dynamodb_table.ontology_jobs.name
      GOLD_BUCKET_NAME = aws_s3_bucket.datalake_gold.id
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_plan_extract_permissions,
    aws_cloudwatch_log_group.ontology_plan_extract,
  ]
}

# --- ontology_extract_pages — one branch of the extraction Map -------------
# Holds a socket open to the runtime for the length of a batch, which is the entire
# point: the Map's concurrency is the fan-out. It holds no extraction logic and
# touches no bucket and no secret, because the runtime does the work on the caller's
# own Claude subscription. Reserved concurrency caps how many batches can be in
# flight whatever the Map is configured to, so a large build cannot starve every
# other Lambda in the account.
resource "aws_iam_role" "ontology_extract_pages_exec" {
  name               = "${local.name_prefix}-ontology-extract-pages-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_extract_pages_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  # Read only. The sub and email come from the job row, never from the item stream.
  statement {
    sid       = "JobTableRead"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }

  statement {
    sid     = "InvokeOntologyAgent"
    actions = ["bedrock-agentcore:InvokeAgentRuntime"]
    resources = [
      aws_bedrockagentcore_agent_runtime.ontology_agent.agent_runtime_arn,
      "${aws_bedrockagentcore_agent_runtime.ontology_agent.agent_runtime_arn}/*",
    ]
  }
}

resource "aws_iam_role_policy" "ontology_extract_pages_permissions" {
  name   = "${local.name_prefix}-ontology-extract-pages-policy"
  role   = aws_iam_role.ontology_extract_pages_exec.id
  policy = data.aws_iam_policy_document.ontology_extract_pages_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_extract_pages" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-extract-pages"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_extract_pages" {
  function_name                  = "${local.name_prefix}-ontology-extract-pages"
  runtime                        = "python3.12"
  handler                        = "control.extract_pages.lambda_handler"
  filename                       = data.archive_file.ontology_control.output_path
  source_code_hash               = data.archive_file.ontology_control.output_base64sha256
  role                           = aws_iam_role.ontology_extract_pages_exec.arn
  timeout                        = 900
  memory_size                    = 256
  reserved_concurrent_executions = 50
  layers                         = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE         = aws_dynamodb_table.ontology_jobs.name
      AGENT_RUNTIME_ARN = aws_bedrockagentcore_agent_runtime.ontology_agent.agent_runtime_arn
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_extract_pages_permissions,
    aws_cloudwatch_log_group.ontology_extract_pages,
  ]
}

# --- ontology_compact_elements — one pass that replaces five ---------------
# Streams the per-page elements once and derives the three things every later stage
# wanted: a streamable index, the aggregated raw vocabulary, and the corpus-wide
# extraction counters. The per-page objects are kept — they are the idempotent write
# unit an extract retry overwrites.
resource "aws_iam_role" "ontology_compact_elements_exec" {
  name               = "${local.name_prefix}-ontology-compact-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_compact_elements_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "JobTableRead"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }

  statement {
    sid = "GoldReadWrite"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]
    resources = ["${aws_s3_bucket.datalake_gold.arn}/users/*"]
  }

  statement {
    sid       = "LakeList"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.datalake_gold.arn]
  }
}

resource "aws_iam_role_policy" "ontology_compact_elements_permissions" {
  name   = "${local.name_prefix}-ontology-compact-policy"
  role   = aws_iam_role.ontology_compact_elements_exec.id
  policy = data.aws_iam_policy_document.ontology_compact_elements_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_compact_elements" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-compact"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_compact_elements" {
  function_name    = "${local.name_prefix}-ontology-compact"
  runtime          = "python3.12"
  handler          = "control.compact_elements.lambda_handler"
  filename         = data.archive_file.ontology_control.output_path
  source_code_hash = data.archive_file.ontology_control.output_base64sha256
  role             = aws_iam_role.ontology_compact_elements_exec.arn
  timeout          = 600
  memory_size      = 2048
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE        = aws_dynamodb_table.ontology_jobs.name
      GOLD_BUCKET_NAME = aws_s3_bucket.datalake_gold.id
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_compact_elements_permissions,
    aws_cloudwatch_log_group.ontology_compact_elements,
  ]
}

# --- ontology_canonicalize — CANONICALIZE ----------------------------------
# Exact matching, content hashing and arithmetic over every element, with no model in
# the loop. It ran as a subagent only because it sat between two stages that needed
# one.
resource "aws_iam_role" "ontology_canonicalize_exec" {
  name               = "${local.name_prefix}-ontology-canonicalize-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_canonicalize_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "JobTableReadWrite"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }

  statement {
    sid = "GoldReadWrite"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]
    resources = ["${aws_s3_bucket.datalake_gold.arn}/users/*"]
  }

  statement {
    sid       = "LakeList"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.datalake_gold.arn]
  }
}

resource "aws_iam_role_policy" "ontology_canonicalize_permissions" {
  name   = "${local.name_prefix}-ontology-canonicalize-policy"
  role   = aws_iam_role.ontology_canonicalize_exec.id
  policy = data.aws_iam_policy_document.ontology_canonicalize_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_canonicalize" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-canonicalize"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_canonicalize" {
  function_name    = "${local.name_prefix}-ontology-canonicalize"
  runtime          = "python3.12"
  handler          = "control.canonicalize_build.lambda_handler"
  filename         = data.archive_file.ontology_control.output_path
  source_code_hash = data.archive_file.ontology_control.output_base64sha256
  role             = aws_iam_role.ontology_canonicalize_exec.arn
  timeout          = 900
  memory_size      = 3008
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE        = aws_dynamodb_table.ontology_jobs.name
      GOLD_BUCKET_NAME = aws_s3_bucket.datalake_gold.id
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_canonicalize_permissions,
    aws_cloudwatch_log_group.ontology_canonicalize,
  ]
}

# --- ontology_emit — EMIT, and the only successful terminal status ---------
# Writes the flat outputs and marks the build terminal. The status is decided, never
# chosen: partial if any document failed to convert, succeeded otherwise, read off the
# job row where the segment Lambda wrote it.
resource "aws_iam_role" "ontology_emit_exec" {
  name               = "${local.name_prefix}-ontology-emit-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_emit_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "JobTableReadWrite"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }

  statement {
    sid = "GoldReadWrite"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]
    resources = ["${aws_s3_bucket.datalake_gold.arn}/users/*"]
  }

  statement {
    sid       = "LakeList"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.datalake_gold.arn]
  }
}

resource "aws_iam_role_policy" "ontology_emit_permissions" {
  name   = "${local.name_prefix}-ontology-emit-policy"
  role   = aws_iam_role.ontology_emit_exec.id
  policy = data.aws_iam_policy_document.ontology_emit_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_emit" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-emit"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_emit" {
  function_name    = "${local.name_prefix}-ontology-emit"
  runtime          = "python3.12"
  handler          = "control.emit_build.lambda_handler"
  filename         = data.archive_file.ontology_control.output_path
  source_code_hash = data.archive_file.ontology_control.output_base64sha256
  role             = aws_iam_role.ontology_emit_exec.arn
  timeout          = 900
  memory_size      = 2048
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE        = aws_dynamodb_table.ontology_jobs.name
      GOLD_BUCKET_NAME = aws_s3_bucket.datalake_gold.id
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_emit_permissions,
    aws_cloudwatch_log_group.ontology_emit,
  ]
}

# --- ontology_fail — the graph branch's single exit for a failure ----------
# Its write is conditional on the row not already being terminal, so a stage that
# failed the row with a far better reason keeps it. It never raises: the state after
# it is a Succeed, because a failing branch would cancel the hydration beside it.
resource "aws_iam_role" "ontology_fail_exec" {
  name               = "${local.name_prefix}-ontology-fail-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_fail_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "JobTableWrite"
    actions   = ["dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }
}

resource "aws_iam_role_policy" "ontology_fail_permissions" {
  name   = "${local.name_prefix}-ontology-fail-policy"
  role   = aws_iam_role.ontology_fail_exec.id
  policy = data.aws_iam_policy_document.ontology_fail_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_fail" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-fail"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_fail" {
  function_name    = "${local.name_prefix}-ontology-fail"
  runtime          = "python3.12"
  handler          = "control.fail_build.lambda_handler"
  filename         = data.archive_file.ontology_control.output_path
  source_code_hash = data.archive_file.ontology_control.output_base64sha256
  role             = aws_iam_role.ontology_fail_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE = aws_dynamodb_table.ontology_jobs.name
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_fail_permissions,
    aws_cloudwatch_log_group.ontology_fail,
  ]
}

# --- ontology_await_review — the build's one human-in-the-loop gate --------
# Invoked through .waitForTaskToken after a conversion that lost documents. It parks
# the task token on the job row and returns; the execution then waits for the review
# endpoint to send that token back with the user's answer.
resource "aws_iam_role" "ontology_await_review_exec" {
  name               = "${local.name_prefix}-ontology-await-review-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_await_review_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "JobTableWrite"
    actions   = ["dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }
}

resource "aws_iam_role_policy" "ontology_await_review_permissions" {
  name   = "${local.name_prefix}-ontology-await-review-policy"
  role   = aws_iam_role.ontology_await_review_exec.id
  policy = data.aws_iam_policy_document.ontology_await_review_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_await_review" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-await-review"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_await_review" {
  function_name    = "${local.name_prefix}-ontology-await-review"
  runtime          = "python3.12"
  handler          = "control.await_review.lambda_handler"
  filename         = data.archive_file.ontology_control.output_path
  source_code_hash = data.archive_file.ontology_control.output_base64sha256
  role             = aws_iam_role.ontology_await_review_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE = aws_dynamodb_table.ontology_jobs.name
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_await_review_permissions,
    aws_cloudwatch_log_group.ontology_await_review,
  ]
}

# --- ontology_prepare_retry — the other half of that gate ------------------
# Runs when the review is answered with "retry". It rebuilds the Convert Map's input
# from the job row and resets the conversion counters, because SEGMENT's OutputPath
# discards the execution input on its way past. Both bucket names are here to compose
# an S3 URI, so it needs no permission on either bucket.
resource "aws_iam_role" "ontology_prepare_retry_exec" {
  name               = "${local.name_prefix}-ontology-prepare-retry-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_prepare_retry_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "JobTableReadWrite"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }
}

resource "aws_iam_role_policy" "ontology_prepare_retry_permissions" {
  name   = "${local.name_prefix}-ontology-prepare-retry-policy"
  role   = aws_iam_role.ontology_prepare_retry_exec.id
  policy = data.aws_iam_policy_document.ontology_prepare_retry_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_prepare_retry" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-prepare-retry"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_prepare_retry" {
  function_name    = "${local.name_prefix}-ontology-prepare-retry"
  runtime          = "python3.12"
  handler          = "control.prepare_retry.lambda_handler"
  filename         = data.archive_file.ontology_control.output_path
  source_code_hash = data.archive_file.ontology_control.output_base64sha256
  role             = aws_iam_role.ontology_prepare_retry_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE          = aws_dynamodb_table.ontology_jobs.name
      BRONZE_BUCKET_NAME = aws_s3_bucket.datalake_bronze.id
      SILVER_BUCKET_NAME = aws_s3_bucket.datalake_silver.id
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_prepare_retry_permissions,
    aws_cloudwatch_log_group.ontology_prepare_retry,
  ]
}

# --- ontology_start_agent — hands CONSOLIDATE to the agent -----------------
# Invoked on the graph branch once extraction has settled and its output has been
# compacted. It returns as soon as the runtime accepts; the state machine then polls
# agentStatus on the job row. Not an API endpoint: Step Functions is its only caller.
resource "aws_iam_role" "ontology_start_agent_exec" {
  name               = "${local.name_prefix}-ontology-start-agent-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_start_agent_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "JobTableReadWrite"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }

  # The runtime has no JWT authorizer, so this grant is the entire authorization
  # story for starting an agent run.
  statement {
    sid     = "InvokeOntologyAgent"
    actions = ["bedrock-agentcore:InvokeAgentRuntime"]
    resources = [
      aws_bedrockagentcore_agent_runtime.ontology_agent.agent_runtime_arn,
      "${aws_bedrockagentcore_agent_runtime.ontology_agent.agent_runtime_arn}/*",
    ]
  }
}

resource "aws_iam_role_policy" "ontology_start_agent_permissions" {
  name   = "${local.name_prefix}-ontology-start-agent-policy"
  role   = aws_iam_role.ontology_start_agent_exec.id
  policy = data.aws_iam_policy_document.ontology_start_agent_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_start_agent" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-start-agent"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_start_agent" {
  function_name    = "${local.name_prefix}-ontology-start-agent"
  runtime          = "python3.12"
  handler          = "control.start_agent.lambda_handler"
  filename         = data.archive_file.ontology_control.output_path
  source_code_hash = data.archive_file.ontology_control.output_base64sha256
  role             = aws_iam_role.ontology_start_agent_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE         = aws_dynamodb_table.ontology_jobs.name
      AGENT_RUNTIME_ARN = aws_bedrockagentcore_agent_runtime.ontology_agent.agent_runtime_arn
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_start_agent_permissions,
    aws_cloudwatch_log_group.ontology_start_agent,
  ]
}

# --- convert state machine -------------------------------------------------
# CONVERT: one Map branch per document — invoke the existing converter trigger,
# poll its job row until terminal, record the outcome — then SEGMENT once, then the
# graph and the page index in parallel. The ASL is the same file the CDK construct
# reads, so the trees cannot drift.
#
# The machine's own ARNs are built as strings rather than referenced. The state
# machine already depends on this policy, so a policy that referenced the state
# machine would close a real cycle — the same pattern local.converter_trigger_arn
# uses for the converter.
resource "aws_iam_role" "ontology_convert_sfn" {
  name               = "${local.name_prefix}-ontology-convert-role"
  assume_role_policy = data.aws_iam_policy_document.ontology_convert_sfn_trust.json
}

data "aws_iam_policy_document" "ontology_convert_sfn_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "ontology_convert_sfn_permissions" {
  statement {
    sid       = "InvokeConverterTrigger"
    actions   = ["lambda:InvokeFunction"]
    resources = [local.converter_trigger_arn]
  }

  statement {
    sid     = "InvokeBuildLambdas"
    actions = ["lambda:InvokeFunction"]
    resources = [
      aws_lambda_function.ontology_carry_forward.arn,
      aws_lambda_function.ontology_segment.arn,
      aws_lambda_function.ontology_plan_extract.arn,
      aws_lambda_function.ontology_extract_pages.arn,
      aws_lambda_function.ontology_compact_elements.arn,
      aws_lambda_function.ontology_start_agent.arn,
      aws_lambda_function.ontology_canonicalize.arn,
      aws_lambda_function.ontology_emit.arn,
      aws_lambda_function.ontology_fail.arn,
      aws_lambda_function.ontology_await_review.arn,
      aws_lambda_function.ontology_prepare_retry.arn,
      aws_lambda_function.ontology_hydrate_index.arn,
    ]
  }

  statement {
    sid       = "ReadConverterJobs"
    actions   = ["dynamodb:GetItem"]
    resources = [local.converter_jobs_arn]
  }

  # The graph branch polls agentStatus on the build's own row rather than holding a
  # Lambda open for the length of CONSOLIDATE, and every Convert branch bumps the
  # conversion counter on that same row before it ends.
  statement {
    sid       = "ReadWriteOntologyJobs"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }

  # A Distributed Map runs its branches as CHILD executions, so the machine has to be
  # able to start and supervise executions of itself.
  statement {
    sid       = "RunDistributedMapChildren"
    actions   = ["states:StartExecution"]
    resources = [local.ontology_convert_sfn_arn]
  }

  statement {
    sid       = "SuperviseDistributedMapChildren"
    actions   = ["states:DescribeExecution", "states:StopExecution", "states:RedriveExecution"]
    resources = [local.ontology_convert_execution_arn]
  }

  # The Maps read their item lists straight out of gold and write their aggregated
  # results back there, so the state machine itself needs S3 access.
  statement {
    sid       = "GoldRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.datalake_gold.arn}/*"]
  }

  statement {
    sid = "MapResultWrite"
    actions = [
      "s3:PutObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]
    resources = ["${aws_s3_bucket.datalake_gold.arn}/map-results/*"]
  }

  statement {
    sid       = "LakeList"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.datalake_gold.arn]
  }
}

resource "aws_iam_role_policy" "ontology_convert_sfn_permissions" {
  name   = "${local.name_prefix}-ontology-convert-policy"
  role   = aws_iam_role.ontology_convert_sfn.id
  policy = data.aws_iam_policy_document.ontology_convert_sfn_permissions.json
}

resource "aws_sfn_state_machine" "ontology_convert" {
  name     = local.ontology_convert_sfn_name
  role_arn = aws_iam_role.ontology_convert_sfn.arn
  type     = "STANDARD"

  definition = templatefile("${local.ontology_agent_dir}/statemachine/convert.asl.json", {
    converter_trigger_arn  = local.converter_trigger_arn
    converter_job_table    = local.converter_jobs_name
    ontology_job_table     = aws_dynamodb_table.ontology_jobs.name
    gold_bucket            = aws_s3_bucket.datalake_gold.id
    carry_forward_arn      = aws_lambda_function.ontology_carry_forward.arn
    segment_build_arn      = aws_lambda_function.ontology_segment.arn
    plan_extract_arn       = aws_lambda_function.ontology_plan_extract.arn
    extract_pages_arn      = aws_lambda_function.ontology_extract_pages.arn
    compact_elements_arn   = aws_lambda_function.ontology_compact_elements.arn
    start_agent_arn        = aws_lambda_function.ontology_start_agent.arn
    canonicalize_build_arn = aws_lambda_function.ontology_canonicalize.arn
    emit_build_arn         = aws_lambda_function.ontology_emit.arn
    fail_build_arn         = aws_lambda_function.ontology_fail.arn
    await_review_arn       = aws_lambda_function.ontology_await_review.arn
    prepare_retry_arn      = aws_lambda_function.ontology_prepare_retry.arn
    hydrate_index_arn      = aws_lambda_function.ontology_hydrate_index.arn
  })

  depends_on = [aws_iam_role_policy.ontology_convert_sfn_permissions]
}

# --- ontology_start — POST /ontology/build ---------------------------------
resource "aws_iam_role" "ontology_start_exec" {
  name               = "${local.name_prefix}-ontology-start-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_start_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "JobTableWrite"
    actions   = ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }

  # Conversion runs first, so this Lambda starts the state machine rather than the
  # agent. The execution name is the job id, so a retried request cannot start a
  # second conversion pass over the same build.
  statement {
    sid       = "StartConvertExecution"
    actions   = ["states:StartExecution"]
    resources = [aws_sfn_state_machine.ontology_convert.arn]
  }

  # Refuse up front when the caller has saved no Claude token.
  statement {
    sid       = "ReadClaudeTokens"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [aws_secretsmanager_secret.claude_user_tokens.arn]
  }

  # Schema reuse: read a prior build's schema.json and copy it into the new run prefix.
  statement {
    sid       = "PriorSchemaCopy"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.datalake_gold.arn}/users/*"]
  }
}

resource "aws_iam_role_policy" "ontology_start_permissions" {
  name   = "${local.name_prefix}-ontology-start-policy"
  role   = aws_iam_role.ontology_start_exec.id
  policy = data.aws_iam_policy_document.ontology_start_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_start" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-start"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_start" {
  function_name    = "${local.name_prefix}-ontology-start"
  runtime          = "python3.12"
  handler          = "control.start_build.lambda_handler"
  filename         = data.archive_file.ontology_control.output_path
  source_code_hash = data.archive_file.ontology_control.output_base64sha256
  role             = aws_iam_role.ontology_start_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE            = aws_dynamodb_table.ontology_jobs.name
      BRONZE_BUCKET_NAME   = aws_s3_bucket.datalake_bronze.id
      SILVER_BUCKET_NAME   = aws_s3_bucket.datalake_silver.id
      GOLD_BUCKET_NAME     = aws_s3_bucket.datalake_gold.id
      STATE_MACHINE_ARN    = aws_sfn_state_machine.ontology_convert.arn
      CLAUDE_TOKENS_SECRET = aws_secretsmanager_secret.claude_user_tokens.arn
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_start_permissions,
    aws_cloudwatch_log_group.ontology_start,
  ]
}

# --- ontology_status — GET /ontology/status --------------------------------
resource "aws_iam_role" "ontology_status_exec" {
  name               = "${local.name_prefix}-ontology-status-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_status_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "JobTableRead"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }
}

resource "aws_iam_role_policy" "ontology_status_permissions" {
  name   = "${local.name_prefix}-ontology-status-policy"
  role   = aws_iam_role.ontology_status_exec.id
  policy = data.aws_iam_policy_document.ontology_status_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_status" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-status"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_status" {
  function_name    = "${local.name_prefix}-ontology-status"
  runtime          = "python3.12"
  handler          = "control.get_build_status.lambda_handler"
  filename         = data.archive_file.ontology_control.output_path
  source_code_hash = data.archive_file.ontology_control.output_base64sha256
  role             = aws_iam_role.ontology_status_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE = aws_dynamodb_table.ontology_jobs.name
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_status_permissions,
    aws_cloudwatch_log_group.ontology_status,
  ]
}

# --- ontology_list — GET /ontology/builds ----------------------------------
resource "aws_iam_role" "ontology_list_exec" {
  name               = "${local.name_prefix}-ontology-list-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_list_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  # Two queries, one per index — the caller's own builds and everything published —
  # so both index arns are needed alongside the table's.
  statement {
    sid     = "JobTableQuery"
    actions = ["dynamodb:Query"]
    resources = [
      aws_dynamodb_table.ontology_jobs.arn,
      "${aws_dynamodb_table.ontology_jobs.arn}/index/by_owner",
      "${aws_dynamodb_table.ontology_jobs.arn}/index/by_visibility",
    ]
  }
}

resource "aws_iam_role_policy" "ontology_list_permissions" {
  name   = "${local.name_prefix}-ontology-list-policy"
  role   = aws_iam_role.ontology_list_exec.id
  policy = data.aws_iam_policy_document.ontology_list_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_list" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-list"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_list" {
  function_name    = "${local.name_prefix}-ontology-list"
  runtime          = "python3.12"
  handler          = "control.list_builds.lambda_handler"
  filename         = data.archive_file.ontology_control.output_path
  source_code_hash = data.archive_file.ontology_control.output_base64sha256
  role             = aws_iam_role.ontology_list_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE = aws_dynamodb_table.ontology_jobs.name
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_list_permissions,
    aws_cloudwatch_log_group.ontology_list,
  ]
}

# --- ontology_outputs — GET /ontology/builds/{jobId}/outputs ---------------
resource "aws_iam_role" "ontology_outputs_exec" {
  name               = "${local.name_prefix}-ontology-outputs-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_outputs_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "JobTableRead"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }

  statement {
    sid       = "GoldRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.datalake_gold.arn}/users/*"]
  }

  statement {
    sid       = "GoldList"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.datalake_gold.arn]
  }
}

resource "aws_iam_role_policy" "ontology_outputs_permissions" {
  name   = "${local.name_prefix}-ontology-outputs-policy"
  role   = aws_iam_role.ontology_outputs_exec.id
  policy = data.aws_iam_policy_document.ontology_outputs_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_outputs" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-outputs"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_outputs" {
  function_name    = "${local.name_prefix}-ontology-outputs"
  runtime          = "python3.12"
  handler          = "control.get_build_outputs.lambda_handler"
  filename         = data.archive_file.ontology_control.output_path
  source_code_hash = data.archive_file.ontology_control.output_base64sha256
  role             = aws_iam_role.ontology_outputs_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE        = aws_dynamodb_table.ontology_jobs.name
      GOLD_BUCKET_NAME = aws_s3_bucket.datalake_gold.id
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_outputs_permissions,
    aws_cloudwatch_log_group.ontology_outputs,
  ]
}
