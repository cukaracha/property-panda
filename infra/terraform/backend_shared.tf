# Shared backend building blocks reused across the Lambda functions: the
# aws_utils layer (CORS/response helpers + auth-context parser) and the common
# Lambda execution-role trust policy.

# ---------------------------------------------------------------------------
# aws_utils layer (python/aws_utils/* → importable as `aws_utils`)
# ---------------------------------------------------------------------------
data "archive_file" "aws_utils_layer" {
  type        = "zip"
  source_dir  = "${path.module}/../../apps/shared/lambda_layers/aws_utils"
  output_path = "${path.module}/build/aws_utils_layer.zip"
}

resource "aws_lambda_layer_version" "aws_utils" {
  layer_name          = "${local.name_prefix}-aws-utils-layer"
  filename            = data.archive_file.aws_utils_layer.output_path
  source_code_hash    = data.archive_file.aws_utils_layer.output_base64sha256
  compatible_runtimes = ["python3.12"]
}

# ---------------------------------------------------------------------------
# Shared Lambda execution-role trust policy
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}
