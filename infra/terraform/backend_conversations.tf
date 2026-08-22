# conversations domain — read-only proxies over the chat AgentCore Memory
# (ai_agents.tf) that let a user browse and replay their own past chat sessions.
# The browser holds only a Cognito JWT (no Identity Pool), so it can't SigV4-sign
# the AgentCore data-plane; these Cognito-authorized Lambdas front it
# (backend_api.tf):
#   GET /conversations             -> conversations_list (ListSessions)
#   GET /conversations/{sessionId} -> conversations_get  (ListEvents)
# Both derive the actor from the JWT, so a user sees only their own conversations.

# ===========================================================================
# conversations_list — GET /conversations (needs ListSessions on the memory)
# ===========================================================================
data "archive_file" "conversations_list" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/conversations/read/list_conversations.py"
  output_path = "${path.module}/build/conversations_list.zip"
}

resource "aws_iam_role" "conversations_list_exec" {
  name               = "${local.name_prefix}-conversations-list-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "conversations_list_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  # List the caller's sessions on this stack's memory only.
  statement {
    sid       = "ListSessions"
    actions   = ["bedrock-agentcore:ListSessions"]
    resources = [aws_bedrockagentcore_memory.chat.arn, "${aws_bedrockagentcore_memory.chat.arn}/*"]
  }
}

resource "aws_iam_role_policy" "conversations_list_permissions" {
  name   = "${local.name_prefix}-conversations-list-policy"
  role   = aws_iam_role.conversations_list_exec.id
  policy = data.aws_iam_policy_document.conversations_list_permissions.json
}

resource "aws_cloudwatch_log_group" "conversations_list" {
  name              = "/aws/lambda/${local.name_prefix}-conversations-list"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "conversations_list" {
  function_name    = "${local.name_prefix}-conversations-list"
  runtime          = "python3.12"
  handler          = "list_conversations.lambda_handler"
  filename         = data.archive_file.conversations_list.output_path
  source_code_hash = data.archive_file.conversations_list.output_base64sha256
  role             = aws_iam_role.conversations_list_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      MEMORY_ID = aws_bedrockagentcore_memory.chat.id
    }
  }

  depends_on = [
    aws_iam_role_policy.conversations_list_permissions,
    aws_cloudwatch_log_group.conversations_list,
  ]
}

# ===========================================================================
# conversations_get — GET /conversations/{sessionId} (needs ListEvents)
# ===========================================================================
data "archive_file" "conversations_get" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/conversations/read/get_conversation.py"
  output_path = "${path.module}/build/conversations_get.zip"
}

resource "aws_iam_role" "conversations_get_exec" {
  name               = "${local.name_prefix}-conversations-get-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "conversations_get_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  # Replay one session's events on this stack's memory only.
  statement {
    sid       = "ListEvents"
    actions   = ["bedrock-agentcore:ListEvents"]
    resources = [aws_bedrockagentcore_memory.chat.arn, "${aws_bedrockagentcore_memory.chat.arn}/*"]
  }
}

resource "aws_iam_role_policy" "conversations_get_permissions" {
  name   = "${local.name_prefix}-conversations-get-policy"
  role   = aws_iam_role.conversations_get_exec.id
  policy = data.aws_iam_policy_document.conversations_get_permissions.json
}

resource "aws_cloudwatch_log_group" "conversations_get" {
  name              = "/aws/lambda/${local.name_prefix}-conversations-get"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "conversations_get" {
  function_name    = "${local.name_prefix}-conversations-get"
  runtime          = "python3.12"
  handler          = "get_conversation.lambda_handler"
  filename         = data.archive_file.conversations_get.output_path
  source_code_hash = data.archive_file.conversations_get.output_base64sha256
  role             = aws_iam_role.conversations_get_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      MEMORY_ID = aws_bedrockagentcore_memory.chat.id
    }
  }

  depends_on = [
    aws_iam_role_policy.conversations_get_permissions,
    aws_cloudwatch_log_group.conversations_get,
  ]
}
