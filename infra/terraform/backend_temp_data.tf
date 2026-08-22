# temp_data domain — presigned-URL Lambdas fronting the temp bucket
# (data_buckets.tf). Both are Cognito-authorized at the API layer (backend_api.tf):
#   POST /temp-data/upload-url   -> get_upload_url   (read/write on temp bucket)
#   GET  /temp-data/download-url -> get_download_url  (read on temp bucket)

# ===========================================================================
# get_upload_url — presigned PUT (needs read/write on the temp bucket)
# ===========================================================================
data "archive_file" "get_upload_url" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/temp_data/create/get_upload_url.py"
  output_path = "${path.module}/build/get_upload_url.zip"
}

resource "aws_iam_role" "get_upload_url_exec" {
  name               = "${local.name_prefix}-temp-data-upload-url-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "get_upload_url_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

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
}

resource "aws_iam_role_policy" "get_upload_url_permissions" {
  name   = "${local.name_prefix}-temp-data-upload-url-policy"
  role   = aws_iam_role.get_upload_url_exec.id
  policy = data.aws_iam_policy_document.get_upload_url_permissions.json
}

resource "aws_cloudwatch_log_group" "get_upload_url" {
  name              = "/aws/lambda/${local.name_prefix}-temp-data-upload-url"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "get_upload_url" {
  function_name    = "${local.name_prefix}-temp-data-upload-url"
  runtime          = "python3.12"
  handler          = "get_upload_url.lambda_handler"
  filename         = data.archive_file.get_upload_url.output_path
  source_code_hash = data.archive_file.get_upload_url.output_base64sha256
  role             = aws_iam_role.get_upload_url_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      TEMP_BUCKET_NAME = aws_s3_bucket.temp.id
    }
  }

  depends_on = [
    aws_iam_role_policy.get_upload_url_permissions,
    aws_cloudwatch_log_group.get_upload_url,
  ]
}

# ===========================================================================
# get_download_url — presigned GET (needs read on the temp bucket)
# ===========================================================================
data "archive_file" "get_download_url" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/temp_data/read/get_download_url.py"
  output_path = "${path.module}/build/get_download_url.zip"
}

resource "aws_iam_role" "get_download_url_exec" {
  name               = "${local.name_prefix}-temp-data-download-url-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "get_download_url_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "TempBucketRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.temp.arn}/*"]
  }

  statement {
    sid       = "TempBucketList"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.temp.arn]
  }
}

resource "aws_iam_role_policy" "get_download_url_permissions" {
  name   = "${local.name_prefix}-temp-data-download-url-policy"
  role   = aws_iam_role.get_download_url_exec.id
  policy = data.aws_iam_policy_document.get_download_url_permissions.json
}

resource "aws_cloudwatch_log_group" "get_download_url" {
  name              = "/aws/lambda/${local.name_prefix}-temp-data-download-url"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "get_download_url" {
  function_name    = "${local.name_prefix}-temp-data-download-url"
  runtime          = "python3.12"
  handler          = "get_download_url.lambda_handler"
  filename         = data.archive_file.get_download_url.output_path
  source_code_hash = data.archive_file.get_download_url.output_base64sha256
  role             = aws_iam_role.get_download_url_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      TEMP_BUCKET_NAME = aws_s3_bucket.temp.id
    }
  }

  depends_on = [
    aws_iam_role_policy.get_download_url_permissions,
    aws_cloudwatch_log_group.get_download_url,
  ]
}
