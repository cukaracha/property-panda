# bedrock_kb data tier — the shared Amazon S3 Vectors store that backs the
# knowledge base, the S3 bucket holding source documents, the topicId ->
# dataSourceId mapping table, the KB service role Bedrock assumes, and the
# knowledge base itself. The per-topic data source and demo content live in
# data_test.tf.

locals {
  embedding_model_arn = "arn:aws:bedrock:${local.region}::foundation-model/${var.embedding_model_id}"
  kb_arn_wildcard     = "arn:aws:bedrock:${local.region}:${data.aws_caller_identity.current.account_id}:knowledge-base/*"

  kb_vector_bucket_name  = "${local.name_prefix}-kb-vectors"
  kb_vector_index_name   = "kb-main"
  kb_embedding_dimension = 1024 # must match the embedding model (Titan Text Embeddings v2)
}

# ---------------------------------------------------------------------------
# Shared vector store — Amazon S3 Vectors (vector bucket + index)
# ---------------------------------------------------------------------------
# S3 Vectors is a fully managed, serverless vector store. Bedrock writes
# embeddings into the index during ingestion and queries it at retrieval time;
# there is no cluster, VPC, DDL bootstrap, or DB secret. Default SSE-S3 encryption.
resource "aws_s3vectors_vector_bucket" "kb_vectors" {
  vector_bucket_name = local.kb_vector_bucket_name
}

resource "aws_s3vectors_index" "kb_vectors" {
  vector_bucket_name = aws_s3vectors_vector_bucket.kb_vectors.vector_bucket_name
  index_name         = local.kb_vector_index_name
  data_type          = "float32"
  dimension          = local.kb_embedding_dimension
  distance_metric    = "cosine"

  metadata_configuration {
    # Only these two Bedrock-managed keys are non-filterable. The reserved
    # x-amz-bedrock-kb-data-source-id key (which the kb tool filters retrieval on)
    # and any user metadata stay FILTERABLE by omission.
    non_filterable_metadata_keys = ["AMAZON_BEDROCK_TEXT", "AMAZON_BEDROCK_METADATA"]
  }
}

# ---------------------------------------------------------------------------
# KB source-document bucket (one prefix per course)
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "kb_data" {
  bucket        = "${local.name_prefix}-kb-data-${data.aws_caller_identity.current.account_id}-${local.region}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "kb_data" {
  bucket                  = aws_s3_bucket.kb_data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "kb_data" {
  bucket = aws_s3_bucket.kb_data.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# ---------------------------------------------------------------------------
# topicId -> Bedrock dataSourceId mapping
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "kb_topics" {
  name         = "${local.name_prefix}-kb-topics"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "topicId"

  attribute {
    name = "topicId"
    type = "S"
  }
}

# ---------------------------------------------------------------------------
# KB service role — passed to Bedrock at KB-create time (ingestion + retrieval)
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "kb_service_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["bedrock.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = [local.kb_arn_wildcard]
    }
  }
}

resource "aws_iam_role" "kb_service" {
  name               = "${local.name_prefix}-kb-service-role"
  assume_role_policy = data.aws_iam_policy_document.kb_service_trust.json
}

data "aws_iam_policy_document" "kb_service_permissions" {
  statement {
    sid       = "InvokeEmbeddingModel"
    actions   = ["bedrock:InvokeModel"]
    resources = [local.embedding_model_arn]
  }

  statement {
    sid       = "ReadDataBucket"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.kb_data.arn, "${aws_s3_bucket.kb_data.arn}/*"]
  }

  statement {
    sid = "VectorStore"
    actions = [
      "s3vectors:GetIndex",
      "s3vectors:QueryVectors",
      "s3vectors:PutVectors",
      "s3vectors:GetVectors",
      "s3vectors:DeleteVectors",
    ]
    resources = [aws_s3vectors_index.kb_vectors.index_arn]
  }
}

resource "aws_iam_role_policy" "kb_service" {
  name   = "${local.name_prefix}-kb-service-policy"
  role   = aws_iam_role.kb_service.id
  policy = data.aws_iam_policy_document.kb_service_permissions.json
}

# ---------------------------------------------------------------------------
# KB ingestion trigger — fire-and-forget Lambda invoked during apply (per data
# source) to start a Bedrock ingestion job whenever that source's seed docs change.
# The per-source aws_lambda_invocation lives with the data sources in data_test.tf.
# ---------------------------------------------------------------------------
data "archive_file" "kb_sync" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/kb/sync.py"
  output_path = "${path.module}/build/kb_sync.zip"
}

resource "aws_iam_role" "kb_sync" {
  name               = "${local.name_prefix}-kb-sync-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "kb_sync" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "Sync"
    actions   = ["bedrock:StartIngestionJob", "bedrock:ListIngestionJobs"]
    resources = [local.kb_arn_wildcard]
  }
}

resource "aws_iam_role_policy" "kb_sync" {
  name   = "${local.name_prefix}-kb-sync-policy"
  role   = aws_iam_role.kb_sync.id
  policy = data.aws_iam_policy_document.kb_sync.json
}

resource "aws_cloudwatch_log_group" "kb_sync" {
  name              = "/aws/lambda/${local.name_prefix}-kb-sync"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "kb_sync" {
  function_name    = "${local.name_prefix}-kb-sync"
  runtime          = "python3.12"
  handler          = "sync.lambda_handler"
  filename         = data.archive_file.kb_sync.output_path
  source_code_hash = data.archive_file.kb_sync.output_base64sha256
  role             = aws_iam_role.kb_sync.arn
  timeout          = 60
  memory_size      = 256

  depends_on = [aws_iam_role_policy.kb_sync, aws_cloudwatch_log_group.kb_sync]
}

# ---------------------------------------------------------------------------
# Bedrock Knowledge Base — Amazon S3 Vectors store, Titan v2 embeddings
# ---------------------------------------------------------------------------
resource "aws_bedrockagent_knowledge_base" "this" {
  name     = "${local.name_prefix}-kb"
  role_arn = aws_iam_role.kb_service.arn

  knowledge_base_configuration {
    type = "VECTOR"

    vector_knowledge_base_configuration {
      embedding_model_arn = local.embedding_model_arn

      embedding_model_configuration {
        bedrock_embedding_model_configuration {
          dimensions          = 1024
          embedding_data_type = "FLOAT32"
        }
      }
    }
  }

  storage_configuration {
    type = "S3_VECTORS"

    # Bedrock manages the field layout inside the S3 vector index; it writes the raw
    # text and its source metadata (incl. the reserved x-amz-bedrock-kb-data-source-id
    # key the kb tool filters on) as vector metadata during ingestion.
    s3_vectors_configuration {
      index_arn = aws_s3vectors_index.kb_vectors.index_arn
    }
  }

  depends_on = [
    aws_iam_role_policy.kb_service,
  ]
}
