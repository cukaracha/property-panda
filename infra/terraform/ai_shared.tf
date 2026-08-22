# ai/shared — building blocks shared across the AI domain.
#
# Third-party API keys (Mistral for the markdown-converter worker, Brave for the
# web_search tool). Seeded with EMPTY placeholder values — set the real keys
# AFTER deploy, e.g.:
#   aws secretsmanager put-secret-value \
#     --secret-id <name_prefix>-apikeys-secret \
#     --secret-string '{"MISTRAL_API_KEY":"...","BRAVE_API_KEY":"..."}'
# The converter worker and web_search tool are granted read access to this secret.
resource "aws_secretsmanager_secret" "api_keys" {
  name        = "${local.name_prefix}-apikeys-secret"
  description = "Third-party API keys (Mistral, Brave) for the converter worker and web_search tool"
}

resource "aws_secretsmanager_secret_version" "api_keys" {
  secret_id = aws_secretsmanager_secret.api_keys.id
  secret_string = jsonencode({
    MISTRAL_API_KEY = ""
    BRAVE_API_KEY   = ""
  })
}
