# The medallion data lake behind the ontology feature. One bucket per layer,
# every object under a per-user prefix:
#   bronze: users/{sub}/{buildId}/{assetId}.{ext}   raw uploads
#   silver: users/{sub}/{buildId}/{doc}.md          converted markdown
#   gold:   users/{sub}/{buildId}/{nodes,edges,...} ontology outputs
#
# Every layer is reachable from the browser through a presigned URL, so every layer
# carries the CORS rule AND transfer acceleration: the browser PUTs into bronze, the
# ontology page GETs its outputs straight out of gold, and silver is served by
# /datalake/download-url (backend_datalake.tf). Acceleration is not optional per
# bucket — s3_utils.py mints every presigned URL against the accelerate endpoint, and
# S3 answers an unaccelerated bucket there with a 400 that carries no CORS header.
#
# CORS grants nothing: the buckets stay fully public-access-blocked, and each request
# still needs a signature scoped to the caller's own users/{sub}/ prefix.
#
# None of the three has an expiry rule — unlike the temp bucket, a stored ontology
# has to survive so a user can retrieve it later. force_destroy = true mirrors the
# CDK dev-sample autoDeleteObjects.

# ===========================================================================
# bronze — raw uploads (browser writes here via presigned PUT)
# ===========================================================================
resource "aws_s3_bucket" "datalake_bronze" {
  bucket        = "${local.name_prefix}-datalake-bronze-${data.aws_caller_identity.current.account_id}-${local.region}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "datalake_bronze" {
  bucket                  = aws_s3_bucket.datalake_bronze.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "datalake_bronze" {
  bucket = aws_s3_bucket.datalake_bronze.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_ownership_controls" "datalake_bronze" {
  bucket = aws_s3_bucket.datalake_bronze.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_cors_configuration" "datalake_bronze" {
  bucket = aws_s3_bucket.datalake_bronze.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "GET"]
    allowed_origins = local.allowed_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_accelerate_configuration" "datalake_bronze" {
  bucket = aws_s3_bucket.datalake_bronze.id
  status = "Enabled"
}

resource "aws_s3_bucket_lifecycle_configuration" "datalake_bronze" {
  bucket = aws_s3_bucket.datalake_bronze.id

  # No expiry — only reclaim storage behind uploads abandoned mid-flight.
  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# ===========================================================================
# silver — converted markdown (written by the converter worker)
# ===========================================================================
resource "aws_s3_bucket" "datalake_silver" {
  bucket        = "${local.name_prefix}-datalake-silver-${data.aws_caller_identity.current.account_id}-${local.region}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "datalake_silver" {
  bucket                  = aws_s3_bucket.datalake_silver.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "datalake_silver" {
  bucket = aws_s3_bucket.datalake_silver.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_ownership_controls" "datalake_silver" {
  bucket = aws_s3_bucket.datalake_silver.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_cors_configuration" "datalake_silver" {
  bucket = aws_s3_bucket.datalake_silver.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "GET"]
    allowed_origins = local.allowed_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_accelerate_configuration" "datalake_silver" {
  bucket = aws_s3_bucket.datalake_silver.id
  status = "Enabled"
}

resource "aws_s3_bucket_lifecycle_configuration" "datalake_silver" {
  bucket = aws_s3_bucket.datalake_silver.id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# ===========================================================================
# gold — ontology outputs (written by the ontology agent, durable)
# ===========================================================================
resource "aws_s3_bucket" "datalake_gold" {
  bucket        = "${local.name_prefix}-datalake-gold-${data.aws_caller_identity.current.account_id}-${local.region}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "datalake_gold" {
  bucket                  = aws_s3_bucket.datalake_gold.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "datalake_gold" {
  bucket = aws_s3_bucket.datalake_gold.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_ownership_controls" "datalake_gold" {
  bucket = aws_s3_bucket.datalake_gold.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_cors_configuration" "datalake_gold" {
  bucket = aws_s3_bucket.datalake_gold.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "GET"]
    allowed_origins = local.allowed_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_accelerate_configuration" "datalake_gold" {
  bucket = aws_s3_bucket.datalake_gold.id
  status = "Enabled"
}

resource "aws_s3_bucket_lifecycle_configuration" "datalake_gold" {
  bucket = aws_s3_bucket.datalake_gold.id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}
