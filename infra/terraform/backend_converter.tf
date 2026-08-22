# markdown_converter async job pipeline — an uploaded asset is converted to
# markdown off the request path. Mirrors the CDK Converter construct
# (infra/cdk/lib/constructs/api/Converter.ts):
#   POST /converter/convert  -> converter_trigger  -> 'queued' job row + SQS enqueue
#   (SQS FIFO) -> converter_worker (container) -> conversion + job-row update
#   GET  /converter/status   -> converter_status   -> reads the job row (SPA polls)
# The API routes + invoke permissions live in backend_api.tf (next to the other
# routes); this file owns the async infra and the three Lambdas.

# ---------------------------------------------------------------------------
# Worker container-image build inputs. The repo builds images via an ECR repo +
# terraform_data local-exec + hash-tagged image URI (ai_agents.tf number_specialist);
# this mirrors that, x86_64 (the LibreOffice base is x86_64) instead of ARM64.
# ---------------------------------------------------------------------------
locals {
  converter_worker_dir = "${path.module}/../../apps/ai/tools/markdown_converter"

  # Hash every source file under the worker dir (excluding generated __pycache__),
  # so a code change yields a new immutable image tag that busts Lambda's image cache.
  converter_worker_files = sort([
    for f in fileset(local.converter_worker_dir, "**/*") : f
    if !strcontains(f, "__pycache__")
  ])

  converter_worker_source_hash = sha1(join("", [
    for f in local.converter_worker_files : filesha256("${local.converter_worker_dir}/${f}")
  ]))

  converter_worker_registry  = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${local.region}.amazonaws.com"
  converter_worker_image_uri = "${aws_ecr_repository.converter_worker.repository_url}:${local.converter_worker_source_hash}"
}

# ---------------------------------------------------------------------------
# ECR repository — holds the worker container image
# ---------------------------------------------------------------------------
resource "aws_ecr_repository" "converter_worker" {
  name = "${local.name_prefix}-converter-worker"

  # MUTABLE so a re-push of the same hash tag (rare) doesn't error; force_delete
  # lets `terraform destroy` remove the repo with images present.
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

# ---------------------------------------------------------------------------
# Build & push the x86_64 image — only when the worker's sources change
# ---------------------------------------------------------------------------
resource "terraform_data" "converter_worker_build" {
  # Rebuild+push when the worker source changes (hash), the marker is bumped, the ECR
  # image is missing (self-healing guard), or the shared build helper changes.
  triggers_replace = [
    local.converter_worker_source_hash,
    "no-attestations-v1",
    data.external.ecr_image["converter_worker"].result.present,
    filesha256("${path.module}/../../scripts/build_container_image.sh"),
  ]

  # linux/amd64 → ECR (hash tag) via the shared, cache-capped buildx builder.
  provisioner "local-exec" {
    command = "${path.module}/../../scripts/build_container_image.sh --context ${local.converter_worker_dir} --tag ${local.converter_worker_image_uri}"
  }

  depends_on = [aws_ecr_repository.converter_worker]
}

# ---------------------------------------------------------------------------
# Job status table — one row per conversion job (status queued|processing|
# succeeded|failed, set by the handlers). TTL reaps finished rows.
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "converter_jobs" {
  name         = "${local.name_prefix}-converter-jobs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "jobId"

  attribute {
    name = "jobId"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

# ---------------------------------------------------------------------------
# SQS FIFO job queue + FIFO DLQ
# ---------------------------------------------------------------------------
resource "aws_sqs_queue" "converter_dlq" {
  name                      = "${local.name_prefix}-converter-dlq.fifo"
  fifo_queue                = true
  message_retention_seconds = 86400 # 1 day
}

# visibility_timeout is 6x the worker's 15-min timeout per SQS event-source
# guidance (5400s); content-based dedup (the trigger sends only a
# MessageGroupId = jobId, no explicit dedup id).
resource "aws_sqs_queue" "converter_jobs" {
  name                        = "${local.name_prefix}-converter-queue.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  visibility_timeout_seconds  = 5400
  message_retention_seconds   = 86400 # 1 day

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.converter_dlq.arn
    maxReceiveCount     = 3
  })
}

# ===========================================================================
# converter_worker — container image Lambda (x86_64), SQS-triggered
# ===========================================================================
resource "aws_iam_role" "converter_worker_exec" {
  name               = "${local.name_prefix}-converter-worker-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "converter_worker_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  # Temp bucket read/write (mirrors CDK tempBucket.grantReadWrite).
  statement {
    sid       = "TempBucketReadWrite"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"]
    resources = ["${aws_s3_bucket.temp.arn}/*"]
  }

  statement {
    sid       = "TempBucketList"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.temp.arn]
  }

  # Ontology-agent conversions read bronze and write silver.
  statement {
    sid       = "BronzeRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.datalake_bronze.arn}/*"]
  }

  statement {
    sid       = "SilverReadWrite"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"]
    resources = ["${aws_s3_bucket.datalake_silver.arn}/*"]
  }

  statement {
    sid     = "LakeList"
    actions = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [
      aws_s3_bucket.datalake_bronze.arn,
      aws_s3_bucket.datalake_silver.arn,
    ]
  }

  # ApiKeys secret read (mirrors CDK apiKeysSecret.grantRead; env SECRET_ARN).
  statement {
    sid       = "ApiKeysSecretRead"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [aws_secretsmanager_secret.api_keys.arn]
  }

  # Job table read/write (mirrors CDK jobTable.grantReadWriteData).
  statement {
    sid = "JobTableReadWrite"
    actions = [
      "dynamodb:BatchGetItem",
      "dynamodb:GetRecords",
      "dynamodb:GetShardIterator",
      "dynamodb:Query",
      "dynamodb:GetItem",
      "dynamodb:Scan",
      "dynamodb:ConditionCheckItem",
      "dynamodb:BatchWriteItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:DescribeTable",
    ]
    resources = [aws_dynamodb_table.converter_jobs.arn]
  }

  # No AWS-managed grant for Transcribe — the audio/video converter path
  # (clients/transcribe_client.py) starts/polls transcription jobs. These
  # actions do not support resource-level scoping.
  statement {
    sid       = "Transcribe"
    actions   = ["transcribe:StartTranscriptionJob", "transcribe:GetTranscriptionJob"]
    resources = ["*"]
  }

  # Bedrock — the image converter path (clients/bedrock_utils.py) describes
  # images with Claude via the Converse API. Any-region foundation-model +
  # inference-profile scope covers the cross-region 'global.' inference profile.
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

  # Required for first-use of Anthropic models via the Bedrock marketplace.
  statement {
    sid       = "BedrockMarketplaceSubscription"
    actions   = ["aws-marketplace:Subscribe", "aws-marketplace:ViewSubscriptions"]
    resources = ["*"]
  }

  # SQS event source consume perms. CDK's addEventSource grants these implicitly;
  # Terraform's aws_lambda_event_source_mapping requires them on the role.
  statement {
    sid = "JobQueueConsume"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ChangeMessageVisibility",
      "sqs:GetQueueUrl",
    ]
    resources = [aws_sqs_queue.converter_jobs.arn]
  }
}

resource "aws_iam_role_policy" "converter_worker_permissions" {
  name   = "${local.name_prefix}-converter-worker-policy"
  role   = aws_iam_role.converter_worker_exec.id
  policy = data.aws_iam_policy_document.converter_worker_permissions.json
}

resource "aws_cloudwatch_log_group" "converter_worker" {
  name              = "/aws/lambda/${local.name_prefix}-converter-worker"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "converter_worker" {
  function_name = "${local.name_prefix}-converter-worker"
  package_type  = "Image"
  image_uri     = local.converter_worker_image_uri
  role          = aws_iam_role.converter_worker_exec.arn
  architectures = ["x86_64"]
  timeout       = 900  # 15 min
  memory_size   = 3008 # no VPC; 3008 = account Lambda memory ceiling

  environment {
    variables = {
      JOB_TABLE  = aws_dynamodb_table.converter_jobs.name
      SECRET_ARN = aws_secretsmanager_secret.api_keys.arn
    }
  }

  depends_on = [
    terraform_data.converter_worker_build,
    aws_iam_role_policy.converter_worker_permissions,
    aws_cloudwatch_log_group.converter_worker,
  ]
}

# SQS event source drives the worker (batch_size 1 — one job per invoke).
resource "aws_lambda_event_source_mapping" "converter_worker" {
  event_source_arn = aws_sqs_queue.converter_jobs.arn
  function_name    = aws_lambda_function.converter_worker.arn
  batch_size       = 1
}

# ===========================================================================
# converter_trigger — zip Lambda (writes the 'queued' row, enqueues the job)
# ===========================================================================
data "archive_file" "converter_trigger" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/converter/trigger_conversion.py"
  output_path = "${path.module}/build/converter_trigger.zip"
}

resource "aws_iam_role" "converter_trigger_exec" {
  name               = "${local.name_prefix}-converter-trigger-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "converter_trigger_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  # Job table write (mirrors CDK jobTable.grantWriteData). It only builds S3 URIs,
  # so no temp-bucket IAM.
  statement {
    sid = "JobTableWrite"
    actions = [
      "dynamodb:BatchWriteItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:DescribeTable",
    ]
    resources = [aws_dynamodb_table.converter_jobs.arn]
  }

  # Queue send (mirrors CDK jobQueue.grantSendMessages).
  statement {
    sid       = "JobQueueSend"
    actions   = ["sqs:SendMessage", "sqs:GetQueueAttributes", "sqs:GetQueueUrl"]
    resources = [aws_sqs_queue.converter_jobs.arn]
  }
}

resource "aws_iam_role_policy" "converter_trigger_permissions" {
  name   = "${local.name_prefix}-converter-trigger-policy"
  role   = aws_iam_role.converter_trigger_exec.id
  policy = data.aws_iam_policy_document.converter_trigger_permissions.json
}

resource "aws_cloudwatch_log_group" "converter_trigger" {
  name              = "/aws/lambda/${local.name_prefix}-converter-trigger"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "converter_trigger" {
  function_name    = "${local.name_prefix}-converter-trigger"
  runtime          = "python3.12"
  handler          = "trigger_conversion.lambda_handler"
  filename         = data.archive_file.converter_trigger.output_path
  source_code_hash = data.archive_file.converter_trigger.output_base64sha256
  role             = aws_iam_role.converter_trigger_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      TEMP_BUCKET_NAME = aws_s3_bucket.temp.id
      # The trigger only builds and validates S3 URIs against these names — it
      # never touches the buckets, so no IAM statement follows.
      BRONZE_BUCKET_NAME = aws_s3_bucket.datalake_bronze.id
      SILVER_BUCKET_NAME = aws_s3_bucket.datalake_silver.id
      JOB_TABLE          = aws_dynamodb_table.converter_jobs.name
      JOB_QUEUE_URL      = aws_sqs_queue.converter_jobs.url
    }
  }

  depends_on = [
    aws_iam_role_policy.converter_trigger_permissions,
    aws_cloudwatch_log_group.converter_trigger,
  ]
}

# ===========================================================================
# converter_status — zip Lambda (reads the job row for the SPA poller)
# ===========================================================================
data "archive_file" "converter_status" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/converter/get_conversion_status.py"
  output_path = "${path.module}/build/converter_status.zip"
}

resource "aws_iam_role" "converter_status_exec" {
  name               = "${local.name_prefix}-converter-status-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "converter_status_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  # Job table read (mirrors CDK jobTable.grantReadData).
  statement {
    sid = "JobTableRead"
    actions = [
      "dynamodb:BatchGetItem",
      "dynamodb:GetRecords",
      "dynamodb:GetShardIterator",
      "dynamodb:Query",
      "dynamodb:GetItem",
      "dynamodb:Scan",
      "dynamodb:ConditionCheckItem",
      "dynamodb:DescribeTable",
    ]
    resources = [aws_dynamodb_table.converter_jobs.arn]
  }
}

resource "aws_iam_role_policy" "converter_status_permissions" {
  name   = "${local.name_prefix}-converter-status-policy"
  role   = aws_iam_role.converter_status_exec.id
  policy = data.aws_iam_policy_document.converter_status_permissions.json
}

resource "aws_cloudwatch_log_group" "converter_status" {
  name              = "/aws/lambda/${local.name_prefix}-converter-status"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "converter_status" {
  function_name    = "${local.name_prefix}-converter-status"
  runtime          = "python3.12"
  handler          = "get_conversion_status.lambda_handler"
  filename         = data.archive_file.converter_status.output_path
  source_code_hash = data.archive_file.converter_status.output_base64sha256
  role             = aws_iam_role.converter_status_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      JOB_TABLE = aws_dynamodb_table.converter_jobs.name
    }
  }

  depends_on = [
    aws_iam_role_policy.converter_status_permissions,
    aws_cloudwatch_log_group.converter_status,
  ]
}
