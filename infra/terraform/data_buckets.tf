# Browser-facing S3 buckets fronted by the temp_data presigned-URL API
# (backend_temp_data.tf / backend_api.tf):
#   - user_data: durable per-user assets.
#   - temp:      scratch uploads, auto-expired after 1 day.
# Both block public access, allow browser PUT/GET from the configured origins
# (ExposeHeaders: ETag), and enable S3 Transfer Acceleration — the presigned URLs
# are minted against the accelerate endpoint (see aws_utils/s3_utils.py).
# force_destroy = true mirrors the CDK dev-sample autoDeleteObjects.

# ===========================================================================
# user-data bucket (durable assets)
# ===========================================================================
resource "aws_s3_bucket" "user_data" {
  bucket        = "${local.name_prefix}-user-data-${data.aws_caller_identity.current.account_id}-${local.region}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "user_data" {
  bucket                  = aws_s3_bucket.user_data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "user_data" {
  bucket = aws_s3_bucket.user_data.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "GET"]
    allowed_origins = local.allowed_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_accelerate_configuration" "user_data" {
  bucket = aws_s3_bucket.user_data.id
  status = "Enabled"
}

# ===========================================================================
# temp bucket (scratch uploads — objects expire 1 day after upload)
# ===========================================================================
resource "aws_s3_bucket" "temp" {
  bucket        = "${local.name_prefix}-temp-${data.aws_caller_identity.current.account_id}-${local.region}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "temp" {
  bucket                  = aws_s3_bucket.temp.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "temp" {
  bucket = aws_s3_bucket.temp.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "GET"]
    allowed_origins = local.allowed_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_accelerate_configuration" "temp" {
  bucket = aws_s3_bucket.temp.id
  status = "Enabled"
}

resource "aws_s3_bucket_lifecycle_configuration" "temp" {
  bucket = aws_s3_bucket.temp.id

  rule {
    id     = "expire-temp-objects"
    status = "Enabled"

    # Apply to every object in the bucket.
    filter {}

    expiration {
      days = 1
    }
  }
}
