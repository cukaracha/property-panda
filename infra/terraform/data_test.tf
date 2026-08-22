# bedrock_kb demo/test data — the quantum_physics (PHYS2001) data source, its lesson
# documents uploaded to S3, and the topicId -> dataSourceId mapping that makes the
# course_knowledge_base tool testable end to end. Demo content lives here, separate
# from the core KB infra in data_kb.tf.

resource "aws_bedrockagent_data_source" "quantum_physics" {
  knowledge_base_id = aws_bedrockagent_knowledge_base.this.id
  name              = "${local.name_prefix}-kb-quantum-physics"

  data_source_configuration {
    type = "S3"

    s3_configuration {
      bucket_arn         = aws_s3_bucket.kb_data.arn
      inclusion_prefixes = ["quantum_physics/"]
    }
  }
}

# Upload every lesson document under infra/seed/quantum_physics/ to the bucket's
# quantum_physics/ prefix. Sourced from the web app's lesson data
# (apps/ui/web/src/data/quantum_physics), converted to ingestible Markdown.
resource "aws_s3_object" "quantum_physics_docs" {
  for_each = fileset("${path.module}/../seed/quantum_physics", "**")

  bucket       = aws_s3_bucket.kb_data.id
  key          = "quantum_physics/${each.value}"
  source       = "${path.module}/../seed/quantum_physics/${each.value}"
  source_hash  = filemd5("${path.module}/../seed/quantum_physics/${each.value}")
  content_type = "text/markdown"
}

# topicId -> dataSourceId for PHYS2001 (Quantum Physics). "phys2001" is the topic id
# used in the webapp route (topics/:topicId) and is what the agent passes as topicId.
resource "aws_dynamodb_table_item" "kb_topic_phys2001" {
  table_name = aws_dynamodb_table.kb_topics.name
  hash_key   = aws_dynamodb_table.kb_topics.hash_key

  item = jsonencode({
    topicId      = { S = "phys2001" }
    dataSourceId = { S = aws_bedrockagent_data_source.quantum_physics.data_source_id }
  })
}

resource "aws_bedrockagent_data_source" "art_history" {
  knowledge_base_id = aws_bedrockagent_knowledge_base.this.id
  name              = "${local.name_prefix}-kb-art-history"

  data_source_configuration {
    type = "S3"

    s3_configuration {
      bucket_arn         = aws_s3_bucket.kb_data.arn
      inclusion_prefixes = ["art_history/"]
    }
  }
}

# Upload every lesson document under infra/seed/art_history/ to the bucket's
# art_history/ prefix. Sourced from the web app's lesson data
# (apps/ui/web/src/data/art_history), converted to ingestible Markdown.
resource "aws_s3_object" "art_history_docs" {
  for_each = fileset("${path.module}/../seed/art_history", "**")

  bucket       = aws_s3_bucket.kb_data.id
  key          = "art_history/${each.value}"
  source       = "${path.module}/../seed/art_history/${each.value}"
  source_hash  = filemd5("${path.module}/../seed/art_history/${each.value}")
  content_type = "text/markdown"
}

# topicId -> dataSourceId for ARTH1000 (Art History). "arth1000" is the topic id
# used in the webapp route (topics/:topicId) and is what the agent passes as topicId.
resource "aws_dynamodb_table_item" "kb_topic_arth1000" {
  table_name = aws_dynamodb_table.kb_topics.name
  hash_key   = aws_dynamodb_table.kb_topics.hash_key

  item = jsonencode({
    topicId      = { S = "arth1000" }
    dataSourceId = { S = aws_bedrockagent_data_source.art_history.data_source_id }
  })
}

# Auto-index each data source during apply. aws_lambda_invocation re-runs only when its
# input changes, so docs_hash (a digest of the uploaded seed objects) triggers a fresh
# ingestion job only for the source whose seed docs changed. Referencing the s3 object
# etags also orders each invocation after its uploads. See the kb_sync Lambda in data_kb.tf.
locals {
  kb_ingestion_sources = {
    quantum_physics = {
      data_source_id = aws_bedrockagent_data_source.quantum_physics.data_source_id
      docs_hash      = sha1(join(",", [for o in aws_s3_object.quantum_physics_docs : o.etag]))
    }
    art_history = {
      data_source_id = aws_bedrockagent_data_source.art_history.data_source_id
      docs_hash      = sha1(join(",", [for o in aws_s3_object.art_history_docs : o.etag]))
    }
  }
}

resource "aws_lambda_invocation" "kb_sync" {
  for_each      = local.kb_ingestion_sources
  function_name = aws_lambda_function.kb_sync.function_name

  input = jsonencode({
    knowledge_base_id = aws_bedrockagent_knowledge_base.this.id
    data_source_id    = each.value.data_source_id
    docs_hash         = each.value.docs_hash
  })
}
