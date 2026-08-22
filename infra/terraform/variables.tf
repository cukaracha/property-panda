# App identity and the deploy region (stage, region, app_name,
# approved_email_domains) live in the root AppConfig.json, loaded via locals.tf.
# The variables below are deployment knobs that intentionally stay overridable
# via -var.

variable "log_retention_days" {
  description = "CloudWatch log retention (days) for the Lambda log groups."
  type        = number
  default     = 14
}

variable "embedding_model_id" {
  description = "Bedrock embedding model used by the knowledge base. Titan Text Embeddings v2 produces 1024-dim vectors (must match the S3 vector index dimension in data_kb.tf)."
  type        = string
  default     = "amazon.titan-embed-text-v2:0"
}
