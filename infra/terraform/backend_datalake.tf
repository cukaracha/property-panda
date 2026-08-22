# datalake domain — presigned-URL Lambdas fronting the medallion lake
# (data_datalake.tf). Both are Cognito-authorized at the API layer (backend_api.tf):
#   POST /datalake/upload-url   -> datalake_upload_url   (read/write on bronze)
#   GET  /datalake/download-url -> datalake_download_url  (read on all 3 layers)
# Tenancy lives in the handlers: the users/{sub}/ prefix comes from the verified
# Cognito claim, so the IAM grants only need to be per-bucket.

# ===========================================================================
# datalake_upload_url — presigned PUT into bronze
# ===========================================================================
data "archive_file" "datalake_upload_url" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/datalake/create/get_upload_url.py"
  output_path = "${path.module}/build/datalake_upload_url.zip"
}

resource "aws_iam_role" "datalake_upload_url_exec" {
  name               = "${local.name_prefix}-datalake-upload-url-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "datalake_upload_url_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "BronzeReadWrite"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"]
    resources = ["${aws_s3_bucket.datalake_bronze.arn}/*"]
  }

  statement {
    sid       = "BronzeList"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.datalake_bronze.arn]
  }
}

resource "aws_iam_role_policy" "datalake_upload_url_permissions" {
  name   = "${local.name_prefix}-datalake-upload-url-policy"
  role   = aws_iam_role.datalake_upload_url_exec.id
  policy = data.aws_iam_policy_document.datalake_upload_url_permissions.json
}

resource "aws_cloudwatch_log_group" "datalake_upload_url" {
  name              = "/aws/lambda/${local.name_prefix}-datalake-upload-url"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "datalake_upload_url" {
  function_name    = "${local.name_prefix}-datalake-upload-url"
  runtime          = "python3.12"
  handler          = "get_upload_url.lambda_handler"
  filename         = data.archive_file.datalake_upload_url.output_path
  source_code_hash = data.archive_file.datalake_upload_url.output_base64sha256
  role             = aws_iam_role.datalake_upload_url_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      BRONZE_BUCKET_NAME = aws_s3_bucket.datalake_bronze.id
    }
  }

  depends_on = [
    aws_iam_role_policy.datalake_upload_url_permissions,
    aws_cloudwatch_log_group.datalake_upload_url,
  ]
}

# ===========================================================================
# datalake_download_url — presigned GET across bronze/silver/gold
# ===========================================================================
data "archive_file" "datalake_download_url" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/datalake/read/get_download_url.py"
  output_path = "${path.module}/build/datalake_download_url.zip"
}

resource "aws_iam_role" "datalake_download_url_exec" {
  name               = "${local.name_prefix}-datalake-download-url-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "datalake_download_url_permissions" {
  statement {
    sid     = "Logs"
    actions = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [
      "arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"
    ]
  }

  statement {
    sid     = "LakeRead"
    actions = ["s3:GetObject"]
    resources = [
      "${aws_s3_bucket.datalake_bronze.arn}/*",
      "${aws_s3_bucket.datalake_silver.arn}/*",
      "${aws_s3_bucket.datalake_gold.arn}/*",
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

resource "aws_iam_role_policy" "datalake_download_url_permissions" {
  name   = "${local.name_prefix}-datalake-download-url-policy"
  role   = aws_iam_role.datalake_download_url_exec.id
  policy = data.aws_iam_policy_document.datalake_download_url_permissions.json
}

resource "aws_cloudwatch_log_group" "datalake_download_url" {
  name              = "/aws/lambda/${local.name_prefix}-datalake-download-url"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "datalake_download_url" {
  function_name    = "${local.name_prefix}-datalake-download-url"
  runtime          = "python3.12"
  handler          = "get_download_url.lambda_handler"
  filename         = data.archive_file.datalake_download_url.output_path
  source_code_hash = data.archive_file.datalake_download_url.output_base64sha256
  role             = aws_iam_role.datalake_download_url_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      BRONZE_BUCKET_NAME = aws_s3_bucket.datalake_bronze.id
      SILVER_BUCKET_NAME = aws_s3_bucket.datalake_silver.id
      GOLD_BUCKET_NAME   = aws_s3_bucket.datalake_gold.id
    }
  }

  depends_on = [
    aws_iam_role_policy.datalake_download_url_permissions,
    aws_cloudwatch_log_group.datalake_download_url,
  ]
}
