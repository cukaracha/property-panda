# ai tools — Lambda functions registered as AgentCore Gateway tools (see
# ai_gateway.tf). Each tool is dual-entrypoint: invoked by the gateway as an MCP
# tool target AND directly by API Gateway as a Cognito-authorized REST endpoint
# (see backend_api.tf). Future tool Lambdas are defined in this file too.

# ---------------------------------------------------------------------------
# random_number tool — generates a random integer (takes no input)
# ---------------------------------------------------------------------------
data "archive_file" "random_number" {
  type        = "zip"
  source_file = "${path.module}/../../apps/ai/tools/random_number/random_number.py"
  output_path = "${path.module}/build/random_number.zip"
}

resource "aws_iam_role" "random_number_exec" {
  name               = "${local.name_prefix}-random-number-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "random_number_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }
}

resource "aws_iam_role_policy" "random_number_permissions" {
  name   = "${local.name_prefix}-random-number-policy"
  role   = aws_iam_role.random_number_exec.id
  policy = data.aws_iam_policy_document.random_number_permissions.json
}

resource "aws_cloudwatch_log_group" "random_number" {
  name              = "/aws/lambda/${local.name_prefix}-random-number-tool"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "random_number" {
  function_name    = "${local.name_prefix}-random-number-tool"
  runtime          = "python3.12"
  handler          = "random_number.lambda_handler"
  filename         = data.archive_file.random_number.output_path
  source_code_hash = data.archive_file.random_number.output_base64sha256
  role             = aws_iam_role.random_number_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  depends_on = [
    aws_iam_role_policy.random_number_permissions,
    aws_cloudwatch_log_group.random_number,
  ]
}

# ---------------------------------------------------------------------------
# course_knowledge_base tool — Bedrock KB Retrieve scoped to a topic's data source
# ---------------------------------------------------------------------------
# Maps a topicId to its Bedrock data source id (kb_topics table) and runs a
# Retrieve filtered to that data source. MCP-only (registered in ai_gateway.tf); no
# REST route, so no apigateway invoke permission here.
data "archive_file" "kb" {
  type        = "zip"
  source_file = "${path.module}/../../apps/ai/tools/kb/kb.py"
  output_path = "${path.module}/build/kb.zip"
}

resource "aws_iam_role" "kb_exec" {
  name               = "${local.name_prefix}-kb-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "kb_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "TopicMapping"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.kb_topics.arn]
  }

  statement {
    sid       = "Retrieve"
    actions   = ["bedrock:Retrieve"]
    resources = [aws_bedrockagent_knowledge_base.this.arn]
  }
}

resource "aws_iam_role_policy" "kb_permissions" {
  name   = "${local.name_prefix}-kb-policy"
  role   = aws_iam_role.kb_exec.id
  policy = data.aws_iam_policy_document.kb_permissions.json
}

resource "aws_cloudwatch_log_group" "kb" {
  name              = "/aws/lambda/${local.name_prefix}-kb-tool"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "kb" {
  function_name    = "${local.name_prefix}-kb-tool"
  runtime          = "python3.12"
  handler          = "kb.lambda_handler"
  filename         = data.archive_file.kb.output_path
  source_code_hash = data.archive_file.kb.output_base64sha256
  role             = aws_iam_role.kb_exec.arn
  timeout          = 30 # a single Bedrock Retrieve against the S3 Vectors store
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      KB_ID          = aws_bedrockagent_knowledge_base.this.id
      KB_TOPIC_TABLE = aws_dynamodb_table.kb_topics.name
    }
  }

  depends_on = [
    aws_iam_role_policy.kb_permissions,
    aws_cloudwatch_log_group.kb,
  ]
}

# ---------------------------------------------------------------------------
# web_search tool — Brave Search API candidate results (title/url/snippet,
# metadata only). Reads BRAVE_API_KEY from the shared api-keys secret (SECRET_ARN
# env; ApiKeysSecretRead) and, on the optional llm_eval path, calls Bedrock to
# LLM-filter candidates (InvokeModel). Dual-entrypoint: registered as the
# `web_search` AgentCore Gateway MCP target (ai_gateway.tf) AND fronted by a
# Cognito-authorized REST route (backend_api.tf).
# ---------------------------------------------------------------------------
data "archive_file" "web_search" {
  type        = "zip"
  source_file = "${path.module}/../../apps/ai/tools/web_search/web_search.py"
  output_path = "${path.module}/build/web_search.zip"
}

resource "aws_iam_role" "web_search_exec" {
  name               = "${local.name_prefix}-web-search-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "web_search_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  # BRAVE_API_KEY lives in the shared api-keys secret.
  statement {
    sid       = "ApiKeysSecretRead"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [aws_secretsmanager_secret.api_keys.arn]
  }

  # Bedrock — the optional llm_eval relevance judge (bedrock_utils.converse_text).
  statement {
    sid     = "InvokeModel"
    actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = [
      "arn:aws:bedrock:*::foundation-model/*",
      "arn:aws:bedrock:*:${data.aws_caller_identity.current.account_id}:inference-profile/*",
    ]
  }

  # Required for first-use of Anthropic models via the Bedrock marketplace.
  statement {
    sid       = "BedrockMarketplaceSubscription"
    actions   = ["aws-marketplace:Subscribe", "aws-marketplace:ViewSubscriptions"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "web_search_permissions" {
  name   = "${local.name_prefix}-web-search-policy"
  role   = aws_iam_role.web_search_exec.id
  policy = data.aws_iam_policy_document.web_search_permissions.json
}

resource "aws_cloudwatch_log_group" "web_search" {
  name              = "/aws/lambda/${local.name_prefix}-web-search-tool"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "web_search" {
  function_name    = "${local.name_prefix}-web-search-tool"
  runtime          = "python3.12"
  handler          = "web_search.lambda_handler"
  filename         = data.archive_file.web_search.output_path
  source_code_hash = data.archive_file.web_search.output_base64sha256
  role             = aws_iam_role.web_search_exec.arn
  timeout          = 30
  memory_size      = 512
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      SECRET_ARN = aws_secretsmanager_secret.api_keys.arn
    }
  }

  depends_on = [
    aws_iam_role_policy.web_search_permissions,
    aws_cloudwatch_log_group.web_search,
  ]
}
