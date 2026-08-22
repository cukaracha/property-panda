# ai gateway — an AgentCore Gateway that exposes the tool Lambdas (ai_tools.tf)
# to the chat agent over MCP (streamable HTTP). Inbound auth reuses the same
# Cognito pool/client as the runtime (backend_auth.tf / ai_agents.tf), so the
# agent connects with the user's Cognito access token as a Bearer token.
#
# The agent (ai/agents/chat/main.py) reaches the gateway via the GATEWAY_URL env
# var injected in ai_agents.tf; the gateway invokes each tool Lambda using its
# own IAM role (credential_provider_configuration.gateway_iam_role).

# ---------------------------------------------------------------------------
# Gateway execution role — lets the gateway invoke the tool Lambdas
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "gateway_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["bedrock-agentcore.amazonaws.com"]
    }

    # Confused-deputy protection: only AgentCore resources in this account/region.
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:bedrock-agentcore:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
    }
  }
}

resource "aws_iam_role" "gateway" {
  name               = "${local.name_prefix}-chat-gateway"
  assume_role_policy = data.aws_iam_policy_document.gateway_trust.json
}

data "aws_iam_policy_document" "gateway_permissions" {
  statement {
    sid     = "InvokeToolLambdas"
    actions = ["lambda:InvokeFunction"]

    resources = [
      aws_lambda_function.random_number.arn,
      "${aws_lambda_function.random_number.arn}:*",
      aws_lambda_function.kb.arn,
      "${aws_lambda_function.kb.arn}:*",
      aws_lambda_function.web_search.arn,
      "${aws_lambda_function.web_search.arn}:*",
      aws_lambda_function.web_retrieve.arn,
      "${aws_lambda_function.web_retrieve.arn}:*",
    ]
  }
}

resource "aws_iam_role_policy" "gateway_permissions" {
  name   = "${local.name_prefix}-chat-gateway-policy"
  role   = aws_iam_role.gateway.id
  policy = data.aws_iam_policy_document.gateway_permissions.json
}

# Resource-based permission so the gateway service can invoke the tool Lambda.
# Belt-and-suspenders alongside the gateway role's identity-based grant above.
# If this ever fails with AccessDenied, switch the principal to the gateway-role
# ARN (aws_iam_role.gateway.arn) and drop source_arn/source_account.
resource "aws_lambda_permission" "gateway_invoke_random_number" {
  statement_id   = "AllowAgentCoreGatewayInvokeRandomNumber"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.random_number.function_name
  principal      = "bedrock-agentcore.amazonaws.com"
  source_arn     = aws_bedrockagentcore_gateway.this.gateway_arn
  source_account = data.aws_caller_identity.current.account_id
}

# ---------------------------------------------------------------------------
# Gateway — MCP protocol, Cognito JWT inbound auth (reuses the runtime's pool)
# ---------------------------------------------------------------------------
resource "aws_bedrockagentcore_gateway" "this" {
  # Gateway names allow letters/digits/hyphens (regex ^([0-9a-zA-Z][-]?)+$) —
  # NOT underscores (unlike AgentCore memory/runtime names).
  name            = "${local.name_prefix}-chat-gateway"
  role_arn        = aws_iam_role.gateway.arn
  protocol_type   = "MCP"
  authorizer_type = "CUSTOM_JWT"

  # Reuses the Cognito pool from backend_auth.tf. Inbound callers present a
  # Bearer access token that the gateway validates against the pool's OIDC
  # discovery document. No allowed_audience — Cognito access tokens have no
  # `aud` claim; validation is on the client id. Two clients are allowed:
  #   - the app client (aws_cognito_user_pool_client.this): kept so the user
  #     token still validates during rollout / any direct calls.
  #   - the M2M client (aws_cognito_user_pool_client.gateway_m2m): the agents'
  #     OWN client-credentials token, vended by AgentCore Identity. This is the
  #     real production path — no user-token replay (see backend_auth.tf).
  authorizer_configuration {
    custom_jwt_authorizer {
      discovery_url = "https://cognito-idp.${local.region}.amazonaws.com/${aws_cognito_user_pool.this.id}/.well-known/openid-configuration"
      allowed_clients = [
        aws_cognito_user_pool_client.this.id,
        aws_cognito_user_pool_client.gateway_m2m.id,
      ]
    }
  }
}

# ---------------------------------------------------------------------------
# AgentCore Identity OAuth2 credential provider — how agents get a gateway token
# ---------------------------------------------------------------------------
# Instead of forwarding the user's Cognito token across hops (fragile: expires
# mid-chain, depends on header-forwarding internals), each agent calls AgentCore
# Identity with @requires_access_token(auth_flow="M2M") to mint its OWN gateway
# token. This provider is the M2M definition: a custom OAuth2 client-credentials
# grant against the same Cognito pool, using the secret M2M client. AgentCore
# stores the client secret in its own token vault (client_secret_arn is computed)
# — no Secrets Manager. The Cognito OIDC discovery doc's token_endpoint resolves
# to the hosted-UI domain from backend_auth.tf.
resource "aws_bedrockagentcore_oauth2_credential_provider" "gateway" {
  name                       = "${replace(local.name_prefix, "-", "_")}_gateway_m2m"
  credential_provider_vendor = "CustomOauth2"

  oauth2_provider_config {
    custom_oauth2_provider_config {
      client_id     = aws_cognito_user_pool_client.gateway_m2m.id
      client_secret = aws_cognito_user_pool_client.gateway_m2m.client_secret

      oauth_discovery {
        discovery_url = "https://cognito-idp.${local.region}.amazonaws.com/${aws_cognito_user_pool.this.id}/.well-known/openid-configuration"
      }
    }
  }
}

# ---------------------------------------------------------------------------
# Gateway target — registers the random_number Lambda as an MCP tool
# ---------------------------------------------------------------------------
resource "aws_bedrockagentcore_gateway_target" "random_number" {
  gateway_identifier = aws_bedrockagentcore_gateway.this.gateway_id
  name               = "tools"

  # The gateway invokes the Lambda using its own IAM role (no SigV4 service).
  credential_provider_configuration {
    gateway_iam_role {}
  }

  target_configuration {
    mcp {
      lambda {
        lambda_arn = aws_lambda_function.random_number.arn

        tool_schema {
          inline_payload {
            name        = "generate_random_number"
            description = "Generate a random integer between 1 and 100. Takes no input."

            # No params — the tool takes no caller input.
            input_schema {
              type = "object"
            }
          }
        }
      }
    }
  }

  depends_on = [
    aws_lambda_permission.gateway_invoke_random_number,
    aws_iam_role_policy.gateway_permissions,
  ]
}

# ---------------------------------------------------------------------------
# Gateway target — registers the kb Lambda as the course_knowledge_base MCP tool
# ---------------------------------------------------------------------------
resource "aws_lambda_permission" "gateway_invoke_kb" {
  statement_id   = "AllowAgentCoreGatewayInvokeKb"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.kb.function_name
  principal      = "bedrock-agentcore.amazonaws.com"
  source_arn     = aws_bedrockagentcore_gateway.this.gateway_arn
  source_account = data.aws_caller_identity.current.account_id
}

resource "aws_bedrockagentcore_gateway_target" "kb" {
  gateway_identifier = aws_bedrockagentcore_gateway.this.gateway_id
  name               = "kb"

  credential_provider_configuration {
    gateway_iam_role {}
  }

  target_configuration {
    mcp {
      lambda {
        lambda_arn = aws_lambda_function.kb.arn

        tool_schema {
          inline_payload {
            name        = "course_knowledge_base"
            description = "Search a topic's knowledge base (lesson materials) and return the most relevant passages. Requires the topic id."

            input_schema {
              type = "object"

              property {
                name        = "topicId"
                type        = "string"
                description = "The topic id to search (e.g. phys2001)."
                required    = true
              }

              property {
                name        = "query"
                type        = "string"
                description = "The search query / student question."
                required    = true
              }

              property {
                name        = "topK"
                type        = "number"
                description = "Optional number of passages to return (1-100, default 10)."
              }
            }
          }
        }
      }
    }
  }

  depends_on = [
    aws_lambda_permission.gateway_invoke_kb,
    aws_iam_role_policy.gateway_permissions,
  ]
}

# ---------------------------------------------------------------------------
# Gateway target — registers the web_search Lambda as the web_search MCP tool
# ---------------------------------------------------------------------------
resource "aws_lambda_permission" "gateway_invoke_web_search" {
  statement_id   = "AllowAgentCoreGatewayInvokeWebSearch"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.web_search.function_name
  principal      = "bedrock-agentcore.amazonaws.com"
  source_arn     = aws_bedrockagentcore_gateway.this.gateway_arn
  source_account = data.aws_caller_identity.current.account_id
}

resource "aws_bedrockagentcore_gateway_target" "web_search" {
  gateway_identifier = aws_bedrockagentcore_gateway.this.gateway_id
  name               = "websearch"

  credential_provider_configuration {
    gateway_iam_role {}
  }

  target_configuration {
    mcp {
      lambda {
        lambda_arn = aws_lambda_function.web_search.arn

        tool_schema {
          inline_payload {
            name        = "web_search"
            description = "Search the web (Brave) and return candidate results (title, url, snippet) — metadata only, no page bodies. Set llm_eval=true to have the tool LLM-filter candidates down to the relevant ones (each with a why_relevant); default returns all candidates for the caller to judge. Pair with web_retrieve to read the chosen URLs."

            input_schema {
              type = "object"

              property {
                name        = "query"
                type        = "string"
                description = "The search query (e.g. \"ACME Corp data breach 2024\")."
                required    = true
              }

              property {
                name        = "llm_eval"
                type        = "boolean"
                description = "Optional. When true, the tool LLM-filters candidates to only the relevant ones (each with a why_relevant). Defaults to false (return all candidates)."
              }
            }
          }
        }
      }
    }
  }

  depends_on = [
    aws_lambda_permission.gateway_invoke_web_search,
    aws_iam_role_policy.gateway_permissions,
  ]
}

# ---------------------------------------------------------------------------
# Gateway target — registers the web_retrieve Lambda as the web_retrieve MCP tool
# ---------------------------------------------------------------------------
resource "aws_lambda_permission" "gateway_invoke_web_retrieve" {
  statement_id   = "AllowAgentCoreGatewayInvokeWebRetrieve"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.web_retrieve.function_name
  principal      = "bedrock-agentcore.amazonaws.com"
  source_arn     = aws_bedrockagentcore_gateway.this.gateway_arn
  source_account = data.aws_caller_identity.current.account_id
}

resource "aws_bedrockagentcore_gateway_target" "web_retrieve" {
  gateway_identifier = aws_bedrockagentcore_gateway.this.gateway_id
  name               = "webretrieve"

  credential_provider_configuration {
    gateway_iam_role {}
  }

  target_configuration {
    mcp {
      lambda {
        lambda_arn = aws_lambda_function.web_retrieve.arn

        tool_schema {
          inline_payload {
            name        = "web_retrieve"
            description = "Fetch one URL and return its full clean reader-ready markdown, rendered with a real headless browser (Crawl4AI, JavaScript executed, boilerplate stripped). Call once per URL; pair with web_search to find URLs worth reading."

            input_schema {
              type = "object"

              property {
                name        = "url"
                type        = "string"
                description = "The full http(s) URL of the page to fetch (e.g. https://example.com/article)."
                required    = true
              }
            }
          }
        }
      }
    }
  }

  depends_on = [
    aws_lambda_permission.gateway_invoke_web_retrieve,
    aws_iam_role_policy.gateway_permissions,
  ]
}

# ---------------------------------------------------------------------------
# TODO(mcp): register the ontology tool targets here when MCP is enabled.
# The ontology control Lambdas (aws_lambda_function.ontology_start /
# ontology_status, backend_ontology.tf) already exist, so enabling MCP is purely
# additive — no control-Lambda code change (the handlers keep a commented
# is_gateway_invocation branch ready to activate):
#   1. add the two ARNs to data.aws_iam_policy_document.gateway_permissions.resources,
#   2. add an aws_lambda_permission.gateway_invoke_ontology_* per function
#      (principal bedrock-agentcore.amazonaws.com, source_arn the gateway arn),
#   3. add an aws_bedrockagentcore_gateway_target per function (name
#      start_ontology_build / get_ontology_build_status) with its inline tool_schema,
#      depends_on its permission + aws_iam_role_policy.gateway_permissions.
# ---------------------------------------------------------------------------
