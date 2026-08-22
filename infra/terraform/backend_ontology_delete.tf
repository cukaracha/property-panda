# ontology domain, delete side — tears an ontology build down completely.
#
#   DELETE /ontology/builds/{jobId} -> ontology_delete (202) -> ontology_purge (async)
#
# Split in two because a build's footprint spans six services and a large one is
# thousands of objects, far past API Gateway's 29 second ceiling. The API-facing
# Lambda only proves ownership, parks the row at `deleting` and hands off; the
# worker does the teardown and either drops the row or parks it at `deleteFailed`
# with the reason, which is what makes a failed purge visible and retryable.
#
# The worker is invoked directly with InvocationType="Event" rather than through
# an SQS FIFO queue like the markdown converter: there is one job per build, no
# ordering requirement, and the `deleteFailed` row is a better retry surface than
# a DLQ the user cannot see.
#
# Mirrors the CDK OntologyDeleteFunctions construct.

# ===========================================================================
# ontology_purge — the worker. Reaches every resource a build creates.
# ===========================================================================
data "archive_file" "ontology_purge" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/ontology/delete/purge_ontology.py"
  output_path = "${path.module}/build/ontology_purge.zip"
}

resource "aws_iam_role" "ontology_purge_exec" {
  name               = "${local.name_prefix}-ontology-purge-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_purge_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  # Read the row to confirm the build exists, park it on failure, drop it on success.
  statement {
    sid       = "JobRow"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }

  # The build's own prefix in all three lake buckets, plus the map-results tree
  # that only ever exists in gold.
  statement {
    sid     = "LakeObjects"
    actions = ["s3:GetObject", "s3:DeleteObject"]
    resources = [
      "${aws_s3_bucket.datalake_bronze.arn}/users/*",
      "${aws_s3_bucket.datalake_silver.arn}/users/*",
      "${aws_s3_bucket.datalake_gold.arn}/users/*",
      "${aws_s3_bucket.datalake_gold.arn}/map-results/*",
    ]
  }

  statement {
    sid     = "LakeList"
    actions = ["s3:ListBucket"]
    resources = [
      aws_s3_bucket.datalake_bronze.arn,
      aws_s3_bucket.datalake_silver.arn,
      aws_s3_bucket.datalake_gold.arn,
    ]
  }

  # ListVectors takes no metadata filter, so the whole index is scanned and the
  # build's windows are picked out by their key prefix.
  statement {
    sid     = "PageVectors"
    actions = ["s3vectors:ListVectors", "s3vectors:DeleteVectors"]
    resources = [
      aws_s3vectors_vector_bucket.ontology_vectors.vector_bucket_arn,
      aws_s3vectors_index.ontology_vectors.index_arn,
    ]
  }

  # Cancel a build that is still running. The execution name is the jobId, which
  # is the only reason one build's execution can be addressed.
  statement {
    sid       = "StopBuild"
    actions   = ["states:DescribeExecution", "states:StopExecution"]
    resources = ["arn:aws:states:${local.region}:${data.aws_caller_identity.current.account_id}:execution:${local.ontology_convert_sfn_name}:*"]
  }

  # Erase the conversations held about this build.
  statement {
    sid     = "ChatHistory"
    actions = ["bedrock-agentcore:ListSessions", "bedrock-agentcore:ListEvents", "bedrock-agentcore:DeleteEvent"]
    resources = [
      aws_bedrockagentcore_memory.ontology_chat.arn,
      "${aws_bedrockagentcore_memory.ontology_chat.arn}/*",
    ]
  }
}

resource "aws_iam_role_policy" "ontology_purge_permissions" {
  name   = "${local.name_prefix}-ontology-purge-policy"
  role   = aws_iam_role.ontology_purge_exec.id
  policy = data.aws_iam_policy_document.ontology_purge_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_purge" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-purge"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_purge" {
  function_name    = "${local.name_prefix}-ontology-purge"
  runtime          = "python3.12"
  handler          = "purge_ontology.lambda_handler"
  filename         = data.archive_file.ontology_purge.output_path
  source_code_hash = data.archive_file.ontology_purge.output_base64sha256
  role             = aws_iam_role.ontology_purge_exec.arn
  # Listing and deleting a large build's objects is the slow part.
  timeout     = 900
  memory_size = 1024
  layers      = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE          = aws_dynamodb_table.ontology_jobs.name
      BRONZE_BUCKET_NAME = aws_s3_bucket.datalake_bronze.id
      SILVER_BUCKET_NAME = aws_s3_bucket.datalake_silver.id
      GOLD_BUCKET_NAME   = aws_s3_bucket.datalake_gold.id
      VECTOR_BUCKET      = aws_s3vectors_vector_bucket.ontology_vectors.vector_bucket_name
      VECTOR_INDEX       = aws_s3vectors_index.ontology_vectors.index_name
      STATE_MACHINE_ARN  = aws_sfn_state_machine.ontology_convert.arn
      MEMORY_ID          = aws_bedrockagentcore_memory.ontology_chat.id
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_purge_permissions,
    aws_cloudwatch_log_group.ontology_purge,
  ]
}

# ===========================================================================
# ontology_delete — the API-facing half. Owns nothing but the handoff.
# ===========================================================================
data "archive_file" "ontology_delete" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/ontology/delete/delete_ontology.py"
  output_path = "${path.module}/build/ontology_delete.zip"
}

resource "aws_iam_role" "ontology_delete_exec" {
  name               = "${local.name_prefix}-ontology-delete-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_delete_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  # Prove ownership, then mark the row deleting. No DeleteItem here: only the
  # worker may drop a row, and only after everything else is gone.
  statement {
    sid       = "JobRow"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }

  statement {
    sid       = "StartPurge"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.ontology_purge.arn]
  }
}

resource "aws_iam_role_policy" "ontology_delete_permissions" {
  name   = "${local.name_prefix}-ontology-delete-policy"
  role   = aws_iam_role.ontology_delete_exec.id
  policy = data.aws_iam_policy_document.ontology_delete_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_delete" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-delete"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_delete" {
  function_name    = "${local.name_prefix}-ontology-delete"
  runtime          = "python3.12"
  handler          = "delete_ontology.lambda_handler"
  filename         = data.archive_file.ontology_delete.output_path
  source_code_hash = data.archive_file.ontology_delete.output_base64sha256
  role             = aws_iam_role.ontology_delete_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE           = aws_dynamodb_table.ontology_jobs.name
      PURGE_FUNCTION_NAME = aws_lambda_function.ontology_purge.function_name
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_delete_permissions,
    aws_cloudwatch_log_group.ontology_delete,
  ]
}
