# ontology domain, read side — read-only proxies over the ontology chat AgentCore
# Memory (ai_agents_ontology_chat.tf) that let a user browse and replay their own
# past conversations about one finished ontology. The browser holds only a Cognito
# JWT (no Identity Pool), so it can't SigV4-sign the AgentCore data-plane; these
# Cognito-authorized Lambdas front it (backend_api.tf):
#   GET /ontology/builds/{jobId}/conversations             -> ontology_conversations_list (ListSessions)
#   GET /ontology/builds/{jobId}/conversations/{sessionId} -> ontology_conversations_get  (ListEvents)
#
# Nested under the build because the build IS the scope: the agent stores events
# under a composite "{sub}/{buildId}" actor whose sub half comes from the JWT, so a
# foreign jobId yields an empty list rather than another user's sessions.
# Mirrors the CDK OntologyConversationsFunctions construct.

# ===========================================================================
# ontology_conversations_list — needs ListSessions on the memory
# ===========================================================================
data "archive_file" "ontology_conversations_list" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/ontology/read/list_ontology_conversations.py"
  output_path = "${path.module}/build/ontology_conversations_list.zip"
}

resource "aws_iam_role" "ontology_conversations_list_exec" {
  name               = "${local.name_prefix}-ontology-conversations-list-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_conversations_list_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  # List the caller's sessions on the ontology chat memory only.
  statement {
    sid     = "ListSessions"
    actions = ["bedrock-agentcore:ListSessions"]
    resources = [
      aws_bedrockagentcore_memory.ontology_chat.arn,
      "${aws_bedrockagentcore_memory.ontology_chat.arn}/*",
    ]
  }
}

resource "aws_iam_role_policy" "ontology_conversations_list_permissions" {
  name   = "${local.name_prefix}-ontology-conversations-list-policy"
  role   = aws_iam_role.ontology_conversations_list_exec.id
  policy = data.aws_iam_policy_document.ontology_conversations_list_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_conversations_list" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-conversations-list"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_conversations_list" {
  function_name    = "${local.name_prefix}-ontology-conversations-list"
  runtime          = "python3.12"
  handler          = "list_ontology_conversations.lambda_handler"
  filename         = data.archive_file.ontology_conversations_list.output_path
  source_code_hash = data.archive_file.ontology_conversations_list.output_base64sha256
  role             = aws_iam_role.ontology_conversations_list_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      MEMORY_ID = aws_bedrockagentcore_memory.ontology_chat.id
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_conversations_list_permissions,
    aws_cloudwatch_log_group.ontology_conversations_list,
  ]
}

# ===========================================================================
# ontology_conversations_get — needs ListEvents
# ===========================================================================
data "archive_file" "ontology_conversations_get" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/ontology/read/get_ontology_conversation.py"
  output_path = "${path.module}/build/ontology_conversations_get.zip"
}

resource "aws_iam_role" "ontology_conversations_get_exec" {
  name               = "${local.name_prefix}-ontology-conversations-get-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_conversations_get_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  # Replay one session's events on the ontology chat memory only.
  statement {
    sid     = "ListEvents"
    actions = ["bedrock-agentcore:ListEvents"]
    resources = [
      aws_bedrockagentcore_memory.ontology_chat.arn,
      "${aws_bedrockagentcore_memory.ontology_chat.arn}/*",
    ]
  }
}

resource "aws_iam_role_policy" "ontology_conversations_get_permissions" {
  name   = "${local.name_prefix}-ontology-conversations-get-policy"
  role   = aws_iam_role.ontology_conversations_get_exec.id
  policy = data.aws_iam_policy_document.ontology_conversations_get_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_conversations_get" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-conversations-get"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_conversations_get" {
  function_name    = "${local.name_prefix}-ontology-conversations-get"
  runtime          = "python3.12"
  handler          = "get_ontology_conversation.lambda_handler"
  filename         = data.archive_file.ontology_conversations_get.output_path
  source_code_hash = data.archive_file.ontology_conversations_get.output_base64sha256
  role             = aws_iam_role.ontology_conversations_get_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      MEMORY_ID = aws_bedrockagentcore_memory.ontology_chat.id
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_conversations_get_permissions,
    aws_cloudwatch_log_group.ontology_conversations_get,
  ]
}
