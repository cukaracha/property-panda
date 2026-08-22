# ontology domain, derive side — derives a new build from an existing one.
#
#   POST /ontology/builds/{jobId}/corpus  -> ontology_update (202, the NEW jobId)
#   POST /ontology/builds/{jobId}/redrive -> ontology_update (202, the NEW jobId)
#
# One Lambda for both, because a redrive is a corpus update that keeps every document
# and adds none: the carry-forward stage hands back only what never converted and the
# extraction plan fans out only the pages with no elements.
#
# An update does not mutate the source ontology. It seeds a second build alongside
# it and hands the state machine a carryFrom pointer, and the machine's first stage
# (ontology_carry_forward, in ai_agents_ontology.tf) copies each kept document's
# markdown and extracted elements into the new prefix. Convert then runs over the
# added documents only, and the extraction fan-out skips every carried page.
#
# One Lambda rather than the trigger-plus-worker split the delete side uses: all the
# bulk copying happens inside the state machine, so what is left here is a row write
# and a StartExecution, both of which fit comfortably inside API Gateway's 29 second
# ceiling.
#
# Mirrors the CDK OntologyUpdateFunctions construct.

data "archive_file" "ontology_update" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/ontology/update/update_corpus.py"
  output_path = "${path.module}/build/ontology_update.zip"
}

resource "aws_iam_role" "ontology_update_exec" {
  name               = "${local.name_prefix}-ontology-update-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_update_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  # Read the source row to prove ownership and resolve the kept documents' names,
  # write the derived row, and drop it again if the execution will not start.
  statement {
    sid       = "JobRow"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }

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

  # Schema reuse: read the source build's schema.json and copy it into the new run
  # prefix. Done here rather than in carry_forward so an ontology with no schema is
  # refused as a 400 instead of failing the build minutes later.
  statement {
    sid       = "PriorSchemaCopy"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.datalake_gold.arn}/users/*"]
  }
}

resource "aws_iam_role_policy" "ontology_update_permissions" {
  name   = "${local.name_prefix}-ontology-update-policy"
  role   = aws_iam_role.ontology_update_exec.id
  policy = data.aws_iam_policy_document.ontology_update_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_update" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-update"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_update" {
  function_name    = "${local.name_prefix}-ontology-update"
  runtime          = "python3.12"
  handler          = "update_corpus.lambda_handler"
  filename         = data.archive_file.ontology_update.output_path
  source_code_hash = data.archive_file.ontology_update.output_base64sha256
  role             = aws_iam_role.ontology_update_exec.arn
  timeout          = 30
  memory_size      = 512
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
    aws_iam_role_policy.ontology_update_permissions,
    aws_cloudwatch_log_group.ontology_update,
  ]
}

# --- ontology_publish — POST/DELETE /ontology/builds/{jobId}/publish -------
# Shares one finished ontology with every other user, or takes it back.
#
# Nothing is copied and nothing moves: every read path already resolves a build's
# prefix from its job row rather than from the caller, so all this writes is the
# visibility/publishedAt pair the sparse by_visibility index is keyed on. Which is why
# it holds no bucket permission at all.
#
# Mirrors the publishFunction in the CDK OntologyUpdateFunctions construct.

data "archive_file" "ontology_publish" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/ontology/update/publish_ontology.py"
  output_path = "${path.module}/build/ontology_publish.zip"
}

resource "aws_iam_role" "ontology_publish_exec" {
  name               = "${local.name_prefix}-ontology-publish-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_publish_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  # Read the row to prove ownership, then set or clear the visibility pair.
  statement {
    sid       = "JobRow"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }
}

resource "aws_iam_role_policy" "ontology_publish_permissions" {
  name   = "${local.name_prefix}-ontology-publish-policy"
  role   = aws_iam_role.ontology_publish_exec.id
  policy = data.aws_iam_policy_document.ontology_publish_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_publish" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-publish"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_publish" {
  function_name    = "${local.name_prefix}-ontology-publish"
  runtime          = "python3.12"
  handler          = "publish_ontology.lambda_handler"
  filename         = data.archive_file.ontology_publish.output_path
  source_code_hash = data.archive_file.ontology_publish.output_base64sha256
  role             = aws_iam_role.ontology_publish_exec.arn
  timeout          = 15
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE = aws_dynamodb_table.ontology_jobs.name
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_publish_permissions,
    aws_cloudwatch_log_group.ontology_publish,
  ]
}

# --- ontology_review — POST /ontology/builds/{jobId}/review ----------------
# Answers the conversion review a build stops at when it loses documents.
#
# The only route in this domain that acts on a run in flight: the paused execution is
# holding a Step Functions task token on its job row, and this sends that token back
# with continue, stop, or the set of documents to convert again. A retry rewrites the
# corpus on the row first, because the state machine reads it there rather than out of
# the request.
#
# Mirrors the reviewFunction in the CDK OntologyUpdateFunctions construct.

data "archive_file" "ontology_review" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/ontology/update/review_build.py"
  output_path = "${path.module}/build/ontology_review.zip"
}

resource "aws_iam_role" "ontology_review_exec" {
  name               = "${local.name_prefix}-ontology-review-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "ontology_review_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  # Read the row for the token and the failed documents, write the corpus a retry
  # chose. No bucket: replacements reach bronze through the presign endpoint, and this
  # only records their keys.
  statement {
    sid       = "JobRow"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.ontology_jobs.arn]
  }

  # Sending a task token back is not scoped to a state machine. The token is opaque and
  # carries its own execution, so these two actions take no resource ARN.
  statement {
    sid       = "AnswerBuildReviewGate"
    actions   = ["states:SendTaskSuccess", "states:SendTaskFailure"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "ontology_review_permissions" {
  name   = "${local.name_prefix}-ontology-review-policy"
  role   = aws_iam_role.ontology_review_exec.id
  policy = data.aws_iam_policy_document.ontology_review_permissions.json
}

resource "aws_cloudwatch_log_group" "ontology_review" {
  name              = "/aws/lambda/${local.name_prefix}-ontology-review"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ontology_review" {
  function_name    = "${local.name_prefix}-ontology-review"
  runtime          = "python3.12"
  handler          = "review_build.lambda_handler"
  filename         = data.archive_file.ontology_review.output_path
  source_code_hash = data.archive_file.ontology_review.output_base64sha256
  role             = aws_iam_role.ontology_review_exec.arn
  timeout          = 15
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE = aws_dynamodb_table.ontology_jobs.name
    }
  }

  depends_on = [
    aws_iam_role_policy.ontology_review_permissions,
    aws_cloudwatch_log_group.ontology_review,
  ]
}
