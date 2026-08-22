# backend domain — the per-user Claude subscription tokens the ontology agent runs on.
#
# One secret holds a JSON map of {"<cognito email>": {"token": ..., "updatedAt": ...}}.
# A user adds their own token on the profile page (PUT /profile/claude-token); when
# they start an ontology build, the agent runtime resolves THEIR key, so every run
# consumes the subscription of the person who started it.
#
# No token ever enters Terraform state: the secret is seeded with an empty object
# and ignore_changes keeps every later apply from clobbering what users have written.

resource "aws_secretsmanager_secret" "claude_user_tokens" {
  name        = "${local.name_prefix}-claude-user-tokens"
  description = "JSON map of Cognito email -> Claude subscription OAuth token, written by the profile page"
}

resource "aws_secretsmanager_secret_version" "claude_user_tokens" {
  secret_id     = aws_secretsmanager_secret.claude_user_tokens.id
  secret_string = jsonencode({})

  lifecycle {
    ignore_changes = [secret_string]
  }
}
