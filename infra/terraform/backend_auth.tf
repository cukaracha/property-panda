# user_management domain — the Cognito user pool and the Lambdas behind it.
#
# Self-signup is disabled at the pool level (allow_admin_create_user_only).
# Accounts are created by the self_signup Lambda via AdminCreateUser (which
# emails a temporary password) and are always added to the Users group. First
# login returns a NEW_PASSWORD_REQUIRED challenge where the user sets a
# permanent password + first/last name.

# ===========================================================================
# Cognito user pool + client
# ===========================================================================
resource "aws_cognito_user_pool" "this" {
  name = "${local.name_prefix}-user-pool"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = false
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  schema {
    name                = "given_name"
    attribute_data_type = "String"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  schema {
    name                = "family_name"
    attribute_data_type = "String"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  # Only the required attributes are declared. Optional profile fields the profile
  # page edits (phone_number, birthdate, gender, address) are built-in standard
  # attributes — mutable and writable by default — so they need no schema entry;
  # declaring them only re-states Cognito's defaults and trips the provider's
  # immutable-schema perpetual diff.
}

resource "aws_cognito_user_pool_client" "this" {
  name         = "${local.name_prefix}-app-client"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  # Longer access/id token life (default is 60 min) gives the forwarded Cognito token
  # ample headroom for the multi-hop chat → A2A subagent → MCP gateway chain, where each
  # hop re-validates it and AgentCore rejects tokens with <60s of life. The frontend also
  # refreshes proactively (see getAccessToken); this just makes refreshes rarer. Refresh
  # token left at the 30-day default.
  access_token_validity = 3
  id_token_validity     = 3
  token_validity_units {
    access_token = "hours"
    id_token     = "hours"
  }

  prevent_user_existence_errors = "ENABLED"

  # OAuth is configured only when a federated IdP is enabled; when disabled every
  # arg below is null (unmanaged), so a plan on a config without federatedIdp
  # shows no change to this client. explicit_auth_flows (SRP/PASSWORD/REFRESH) is
  # left untouched → hybrid: password login keeps working alongside SSO. COGNITO
  # stays in the provider list so the password path is still offered.
  allowed_oauth_flows_user_pool_client = local.federated_idp_enabled ? true : null
  allowed_oauth_flows                  = local.federated_idp_enabled ? ["code"] : null
  allowed_oauth_scopes                 = local.federated_idp_enabled ? ["openid", "email", "profile", "aws.cognito.signin.user.admin"] : null
  callback_urls                        = local.federated_idp_enabled ? local.allowed_origins : null
  logout_urls                          = local.federated_idp_enabled ? local.allowed_origins : null
  supported_identity_providers         = local.federated_idp_enabled ? ["COGNITO", "FederatedIdP"] : null

  depends_on = [aws_cognito_identity_provider.federated]
}

# ===========================================================================
# Optional OIDC federated identity provider
# ===========================================================================
# The client secret is never in AppConfig. A placeholder Secrets Manager secret
# is created here; the operator pastes the real value in the Console after the
# IdP app is registered, then re-applies. The data source reads AWSCURRENT each
# plan so the real value propagates into the IdP in place, while ignore_changes
# keeps Terraform from reverting the Console value back to the placeholder. This
# mirrors the CDK unsafeUnwrap() {{resolve:secretsmanager}} dynamic reference.
resource "aws_secretsmanager_secret" "federated_idp" {
  count                   = local.federated_idp_enabled ? 1 : 0
  name                    = "${local.name_prefix}-federated-idp-client-secret"
  description             = "OIDC federated IdP client secret. Update via AWS Console, then re-apply."
  recovery_window_in_days = 0 # mirrors CDK RemovalPolicy.DESTROY
}

resource "aws_secretsmanager_secret_version" "federated_idp" {
  count         = local.federated_idp_enabled ? 1 : 0
  secret_id     = aws_secretsmanager_secret.federated_idp[0].id
  secret_string = "PLACEHOLDER_UPDATE_IN_CONSOLE"

  # Never revert the operator's Console value back to the placeholder.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

data "aws_secretsmanager_secret_version" "federated_idp" {
  count      = local.federated_idp_enabled ? 1 : 0
  secret_id  = aws_secretsmanager_secret.federated_idp[0].id
  depends_on = [aws_secretsmanager_secret_version.federated_idp]
}

resource "aws_cognito_identity_provider" "federated" {
  count         = local.federated_idp_enabled ? 1 : 0
  user_pool_id  = aws_cognito_user_pool.this.id
  provider_name = "FederatedIdP"
  provider_type = "OIDC"

  provider_details = {
    client_id                 = local.federated_idp.client_id
    client_secret             = data.aws_secretsmanager_secret_version.federated_idp[0].secret_string
    attributes_request_method = "GET"
    oidc_issuer               = local.federated_idp.issuer_url
    authorize_scopes          = "openid email profile"
  }

  attribute_mapping = {
    email       = "email"
    given_name  = "given_name"
    family_name = "family_name"
  }

  # Cognito derives the discovery URLs from the issuer and echoes an extra
  # attributes_url_add_attributes key back into provider_details — ignore it so
  # it doesn't churn on every plan.
  lifecycle {
    ignore_changes = [provider_details["attributes_url_add_attributes"]]
  }
}

# ===========================================================================
# Machine-to-machine (client-credentials) auth for the MCP gateway
# ===========================================================================
# Agents do NOT replay the user's token to the gateway. Each agent obtains its
# OWN gateway token via AgentCore Identity (M2M — see ai_gateway.tf's OAuth2
# credential provider). That client-credentials grant needs a Cognito secret
# client, which in turn requires (a) a hosted-UI domain to expose the OAuth2
# token endpoint and (b) a resource server, because Cognito mandates at least
# one custom scope on a client-credentials request. The gateway authorizer only
# checks the client id (not the scope), but the scope must still exist to mint
# the token.
resource "aws_cognito_user_pool_domain" "this" {
  # Globally unique across all AWS accounts; lowercase letters/digits/hyphens only.
  domain       = "${local.name_prefix}-${data.aws_caller_identity.current.account_id}"
  user_pool_id = aws_cognito_user_pool.this.id
}

resource "aws_cognito_resource_server" "gateway" {
  identifier   = "gateway"
  name         = "${local.name_prefix}-gateway"
  user_pool_id = aws_cognito_user_pool.this.id

  scope {
    scope_name        = "invoke"
    scope_description = "Invoke the MCP gateway"
  }
}

resource "aws_cognito_user_pool_client" "gateway_m2m" {
  name         = "${local.name_prefix}-gateway-m2m"
  user_pool_id = aws_cognito_user_pool.this.id

  # Secret client used only by AgentCore Identity's credential provider for the
  # OAuth2 client-credentials grant — never shipped to a browser.
  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["client_credentials"]
  allowed_oauth_scopes                 = aws_cognito_resource_server.gateway.scope_identifiers # ["gateway/invoke"]

  # The OAuth2 token endpoint is served off the hosted-UI domain.
  depends_on = [aws_cognito_user_pool_domain.this]
}

# ===========================================================================
# Groups — new users go to Users; Admins is reserved for manual promotion
# ===========================================================================
resource "aws_cognito_user_group" "admins" {
  name         = "Admins"
  user_pool_id = aws_cognito_user_pool.this.id
  description  = "Administrator group with full access"
  precedence   = 1
}

resource "aws_cognito_user_group" "users" {
  name         = "Users"
  user_pool_id = aws_cognito_user_pool.this.id
  description  = "Standard user group"
  precedence   = 10
}

# ===========================================================================
# self_signup Lambda — creates a Cognito user + adds to the Users group
# ===========================================================================
data "archive_file" "self_signup" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/user_management/create/self_signup.py"
  output_path = "${path.module}/build/self_signup.zip"
}

resource "aws_iam_role" "self_signup_exec" {
  name               = "${local.name_prefix}-self-signup-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "self_signup_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid = "CognitoAdmin"
    actions = [
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminAddUserToGroup",
    ]
    resources = [aws_cognito_user_pool.this.arn]
  }
}

resource "aws_iam_role_policy" "self_signup_permissions" {
  name   = "${local.name_prefix}-self-signup-policy"
  role   = aws_iam_role.self_signup_exec.id
  policy = data.aws_iam_policy_document.self_signup_permissions.json
}

resource "aws_cloudwatch_log_group" "self_signup" {
  name              = "/aws/lambda/${local.name_prefix}-self-signup"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "self_signup" {
  function_name    = "${local.name_prefix}-self-signup"
  runtime          = "python3.12"
  handler          = "self_signup.lambda_handler"
  filename         = data.archive_file.self_signup.output_path
  source_code_hash = data.archive_file.self_signup.output_base64sha256
  role             = aws_iam_role.self_signup_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      USER_POOL_ID = aws_cognito_user_pool.this.id
      # New users always land in the standard Users group, never Admins.
      USER_GROUP       = aws_cognito_user_group.users.name
      APPROVED_DOMAINS = jsonencode(local.approved_email_domains)
    }
  }

  depends_on = [
    aws_iam_role_policy.self_signup_permissions,
    aws_cloudwatch_log_group.self_signup,
  ]
}

# ===========================================================================
# AppConfig-gated demo seeding — a demo admin + demo user for the dev sample.
# Off by default (seedDemoUsers=false) so a normal deploy seeds nothing. The
# permanent password puts each account straight into CONFIRMED (no
# FORCE_CHANGE_PASSWORD), mirroring the CDK adminSetUserPassword custom resource.
# ===========================================================================
resource "aws_cognito_user" "demo_admin" {
  count        = local.seed_demo_users ? 1 : 0
  user_pool_id = aws_cognito_user_pool.this.id
  username     = "admin@example.com"
  password     = "Admin@123"

  attributes = {
    email          = "admin@example.com"
    email_verified = "true"
    given_name     = "Admin"
    family_name    = "Demo"
  }
}

resource "aws_cognito_user_in_group" "demo_admin" {
  count        = local.seed_demo_users ? 1 : 0
  user_pool_id = aws_cognito_user_pool.this.id
  group_name   = aws_cognito_user_group.admins.name
  username     = aws_cognito_user.demo_admin[0].username
}

resource "aws_cognito_user" "demo_user" {
  count        = local.seed_demo_users ? 1 : 0
  user_pool_id = aws_cognito_user_pool.this.id
  username     = "user@example.com"
  password     = "User@123"

  attributes = {
    email          = "user@example.com"
    email_verified = "true"
    given_name     = "User"
    family_name    = "Demo"
  }
}

resource "aws_cognito_user_in_group" "demo_user" {
  count        = local.seed_demo_users ? 1 : 0
  user_pool_id = aws_cognito_user_pool.this.id
  group_name   = aws_cognito_user_group.users.name
  username     = aws_cognito_user.demo_user[0].username
}

# ===========================================================================
# Admin user-management Lambdas — all Cognito-authorized at the API layer
# (backend_api.tf) and self-enforcing the Admins group in the handler. Each is
# granted only the Cognito admin actions it needs, scoped to this pool's ARN.
#   GET    /admin/users -> list_users
#   POST   /admin/users -> create_user
#   PUT    /admin/users -> update_user
#   DELETE /admin/users -> delete_user
# ===========================================================================

# --- list_users ------------------------------------------------------------
data "archive_file" "list_users" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/user_management/read/list_users.py"
  output_path = "${path.module}/build/list_users.zip"
}

resource "aws_iam_role" "list_users_exec" {
  name               = "${local.name_prefix}-list-users-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "list_users_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid = "CognitoRead"
    actions = [
      "cognito-idp:ListUsers",
      "cognito-idp:ListUsersInGroup",
      "cognito-idp:AdminListGroupsForUser",
    ]
    resources = [aws_cognito_user_pool.this.arn]
  }
}

resource "aws_iam_role_policy" "list_users_permissions" {
  name   = "${local.name_prefix}-list-users-policy"
  role   = aws_iam_role.list_users_exec.id
  policy = data.aws_iam_policy_document.list_users_permissions.json
}

resource "aws_cloudwatch_log_group" "list_users" {
  name              = "/aws/lambda/${local.name_prefix}-list-users"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "list_users" {
  function_name    = "${local.name_prefix}-list-users"
  runtime          = "python3.12"
  handler          = "list_users.lambda_handler"
  filename         = data.archive_file.list_users.output_path
  source_code_hash = data.archive_file.list_users.output_base64sha256
  role             = aws_iam_role.list_users_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      USER_POOL_ID = aws_cognito_user_pool.this.id
    }
  }

  depends_on = [
    aws_iam_role_policy.list_users_permissions,
    aws_cloudwatch_log_group.list_users,
  ]
}

# --- create_user -----------------------------------------------------------
data "archive_file" "create_user" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/user_management/create/create_user.py"
  output_path = "${path.module}/build/create_user.zip"
}

resource "aws_iam_role" "create_user_exec" {
  name               = "${local.name_prefix}-create-user-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "create_user_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid = "CognitoCreate"
    actions = [
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminAddUserToGroup",
    ]
    resources = [aws_cognito_user_pool.this.arn]
  }
}

resource "aws_iam_role_policy" "create_user_permissions" {
  name   = "${local.name_prefix}-create-user-policy"
  role   = aws_iam_role.create_user_exec.id
  policy = data.aws_iam_policy_document.create_user_permissions.json
}

resource "aws_cloudwatch_log_group" "create_user" {
  name              = "/aws/lambda/${local.name_prefix}-create-user"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "create_user" {
  function_name    = "${local.name_prefix}-create-user"
  runtime          = "python3.12"
  handler          = "create_user.lambda_handler"
  filename         = data.archive_file.create_user.output_path
  source_code_hash = data.archive_file.create_user.output_base64sha256
  role             = aws_iam_role.create_user_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      USER_POOL_ID = aws_cognito_user_pool.this.id
    }
  }

  depends_on = [
    aws_iam_role_policy.create_user_permissions,
    aws_cloudwatch_log_group.create_user,
  ]
}

# --- update_user -----------------------------------------------------------
data "archive_file" "update_user" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/user_management/update/update_user.py"
  output_path = "${path.module}/build/update_user.zip"
}

resource "aws_iam_role" "update_user_exec" {
  name               = "${local.name_prefix}-update-user-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "update_user_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid = "CognitoUpdate"
    actions = [
      "cognito-idp:AdminUpdateUserAttributes",
      "cognito-idp:AdminListGroupsForUser",
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:AdminRemoveUserFromGroup",
    ]
    resources = [aws_cognito_user_pool.this.arn]
  }
}

resource "aws_iam_role_policy" "update_user_permissions" {
  name   = "${local.name_prefix}-update-user-policy"
  role   = aws_iam_role.update_user_exec.id
  policy = data.aws_iam_policy_document.update_user_permissions.json
}

resource "aws_cloudwatch_log_group" "update_user" {
  name              = "/aws/lambda/${local.name_prefix}-update-user"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "update_user" {
  function_name    = "${local.name_prefix}-update-user"
  runtime          = "python3.12"
  handler          = "update_user.lambda_handler"
  filename         = data.archive_file.update_user.output_path
  source_code_hash = data.archive_file.update_user.output_base64sha256
  role             = aws_iam_role.update_user_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      USER_POOL_ID = aws_cognito_user_pool.this.id
    }
  }

  depends_on = [
    aws_iam_role_policy.update_user_permissions,
    aws_cloudwatch_log_group.update_user,
  ]
}

# --- delete_user -----------------------------------------------------------
data "archive_file" "delete_user" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/user_management/delete/delete_user.py"
  output_path = "${path.module}/build/delete_user.zip"
}

resource "aws_iam_role" "delete_user_exec" {
  name               = "${local.name_prefix}-delete-user-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "delete_user_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "CognitoDelete"
    actions   = ["cognito-idp:AdminDeleteUser"]
    resources = [aws_cognito_user_pool.this.arn]
  }
}

resource "aws_iam_role_policy" "delete_user_permissions" {
  name   = "${local.name_prefix}-delete-user-policy"
  role   = aws_iam_role.delete_user_exec.id
  policy = data.aws_iam_policy_document.delete_user_permissions.json
}

resource "aws_cloudwatch_log_group" "delete_user" {
  name              = "/aws/lambda/${local.name_prefix}-delete-user"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "delete_user" {
  function_name    = "${local.name_prefix}-delete-user"
  runtime          = "python3.12"
  handler          = "delete_user.lambda_handler"
  filename         = data.archive_file.delete_user.output_path
  source_code_hash = data.archive_file.delete_user.output_base64sha256
  role             = aws_iam_role.delete_user_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      USER_POOL_ID = aws_cognito_user_pool.this.id
    }
  }

  depends_on = [
    aws_iam_role_policy.delete_user_permissions,
    aws_cloudwatch_log_group.delete_user,
  ]
}

# ===========================================================================
# profile Lambdas — the caller's own Claude subscription token
#   GET /profile/claude-token -> get_claude_token (read the shared secret)
#   PUT /profile/claude-token -> put_claude_token (compare-and-swap into it)
# Both key the map in backend_secrets.tf off the verified Cognito email claim,
# so a user can only ever touch their own entry.
# ===========================================================================

# --- get_claude_token ------------------------------------------------------
data "archive_file" "get_claude_token" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/user_management/read/get_claude_token.py"
  output_path = "${path.module}/build/get_claude_token.zip"
}

resource "aws_iam_role" "get_claude_token_exec" {
  name               = "${local.name_prefix}-get-claude-token-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "get_claude_token_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "ReadClaudeTokens"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [aws_secretsmanager_secret.claude_user_tokens.arn]
  }
}

resource "aws_iam_role_policy" "get_claude_token_permissions" {
  name   = "${local.name_prefix}-get-claude-token-policy"
  role   = aws_iam_role.get_claude_token_exec.id
  policy = data.aws_iam_policy_document.get_claude_token_permissions.json
}

resource "aws_cloudwatch_log_group" "get_claude_token" {
  name              = "/aws/lambda/${local.name_prefix}-get-claude-token"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "get_claude_token" {
  function_name    = "${local.name_prefix}-get-claude-token"
  runtime          = "python3.12"
  handler          = "get_claude_token.lambda_handler"
  filename         = data.archive_file.get_claude_token.output_path
  source_code_hash = data.archive_file.get_claude_token.output_base64sha256
  role             = aws_iam_role.get_claude_token_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      CLAUDE_TOKENS_SECRET = aws_secretsmanager_secret.claude_user_tokens.arn
    }
  }

  depends_on = [
    aws_iam_role_policy.get_claude_token_permissions,
    aws_cloudwatch_log_group.get_claude_token,
  ]
}

# --- put_claude_token ------------------------------------------------------
data "archive_file" "put_claude_token" {
  type        = "zip"
  source_file = "${path.module}/../../apps/apis/user_management/update/put_claude_token.py"
  output_path = "${path.module}/build/put_claude_token.zip"
}

resource "aws_iam_role" "put_claude_token_exec" {
  name               = "${local.name_prefix}-put-claude-token-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "put_claude_token_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  # PutSecretValue + UpdateSecretVersionStage are the two halves of the
  # compare-and-swap that keeps two users saving at once from losing a token.
  statement {
    sid = "WriteClaudeTokens"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
      "secretsmanager:PutSecretValue",
      "secretsmanager:UpdateSecretVersionStage",
    ]
    resources = [aws_secretsmanager_secret.claude_user_tokens.arn]
  }
}

resource "aws_iam_role_policy" "put_claude_token_permissions" {
  name   = "${local.name_prefix}-put-claude-token-policy"
  role   = aws_iam_role.put_claude_token_exec.id
  policy = data.aws_iam_policy_document.put_claude_token_permissions.json
}

resource "aws_cloudwatch_log_group" "put_claude_token" {
  name              = "/aws/lambda/${local.name_prefix}-put-claude-token"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "put_claude_token" {
  function_name    = "${local.name_prefix}-put-claude-token"
  runtime          = "python3.12"
  handler          = "put_claude_token.lambda_handler"
  filename         = data.archive_file.put_claude_token.output_path
  source_code_hash = data.archive_file.put_claude_token.output_base64sha256
  role             = aws_iam_role.put_claude_token_exec.arn
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.aws_utils.arn]

  environment {
    variables = {
      CLAUDE_TOKENS_SECRET = aws_secretsmanager_secret.claude_user_tokens.arn
    }
  }

  depends_on = [
    aws_iam_role_policy.put_claude_token_permissions,
    aws_cloudwatch_log_group.put_claude_token,
  ]
}
