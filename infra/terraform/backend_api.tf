# REST API Gateway fronting the Lambdas.
#
#   GET  /random-number → Cognito-authorized → random_number tool Lambda
#   POST /users/signup  → public            → self_signup Lambda
#
# OPTIONS methods (MOCK) provide CORS preflight; gateway_response resources add
# CORS headers to authorizer/4xx/5xx errors so the browser surfaces real errors.

resource "aws_api_gateway_rest_api" "this" {
  name        = "${local.name_prefix}-api"
  description = "REST front door for the SPA (Cognito-authorized)."

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_authorizer" "cognito" {
  name            = "${local.name_prefix}-cognito-authorizer"
  type            = "COGNITO_USER_POOLS"
  rest_api_id     = aws_api_gateway_rest_api.this.id
  provider_arns   = [aws_cognito_user_pool.this.arn]
  identity_source = "method.request.header.Authorization"
}

# ---------------------------------------------------------------------------
# GET /random-number (Cognito-authorized) — direct REST entry to the same tool
# Lambda the AgentCore Gateway calls (ai_tools.tf / ai_gateway.tf).
# ---------------------------------------------------------------------------
resource "aws_api_gateway_resource" "random_number" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "random-number"
}

resource "aws_api_gateway_method" "get_random_number" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.random_number.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "random_number" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.random_number.id
  http_method             = aws_api_gateway_method.get_random_number.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.random_number.invoke_arn
}

resource "aws_api_gateway_method" "random_number_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.random_number.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "random_number_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.random_number.id
  http_method = aws_api_gateway_method.random_number_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "random_number_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.random_number.id
  http_method = aws_api_gateway_method.random_number_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "random_number_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.random_number.id
  http_method = aws_api_gateway_method.random_number_options.http_method
  status_code = aws_api_gateway_method_response.random_number_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.random_number_options]
}

# ---------------------------------------------------------------------------
# POST /web-search (Cognito-authorized) — direct REST entry to the same tool
# Lambda the AgentCore Gateway calls (ai_tools.tf / ai_gateway.tf). Body:
# { query, llm_eval? }.
# ---------------------------------------------------------------------------
resource "aws_api_gateway_resource" "web_search" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "web-search"
}

resource "aws_api_gateway_method" "post_web_search" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.web_search.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "web_search" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.web_search.id
  http_method             = aws_api_gateway_method.post_web_search.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.web_search.invoke_arn
}

resource "aws_api_gateway_method" "web_search_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.web_search.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "web_search_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.web_search.id
  http_method = aws_api_gateway_method.web_search_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "web_search_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.web_search.id
  http_method = aws_api_gateway_method.web_search_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "web_search_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.web_search.id
  http_method = aws_api_gateway_method.web_search_options.http_method
  status_code = aws_api_gateway_method_response.web_search_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.web_search_options]
}

# ---------------------------------------------------------------------------
# POST /web-retrieve (Cognito-authorized) — direct REST entry to the same tool
# Lambda the AgentCore Gateway calls (ai_tool_web_retrieve.tf / ai_gateway.tf).
# Body: { url }.
# ---------------------------------------------------------------------------
resource "aws_api_gateway_resource" "web_retrieve" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "web-retrieve"
}

resource "aws_api_gateway_method" "post_web_retrieve" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.web_retrieve.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "web_retrieve" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.web_retrieve.id
  http_method             = aws_api_gateway_method.post_web_retrieve.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.web_retrieve.invoke_arn
}

resource "aws_api_gateway_method" "web_retrieve_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.web_retrieve.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "web_retrieve_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.web_retrieve.id
  http_method = aws_api_gateway_method.web_retrieve_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "web_retrieve_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.web_retrieve.id
  http_method = aws_api_gateway_method.web_retrieve_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "web_retrieve_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.web_retrieve.id
  http_method = aws_api_gateway_method.web_retrieve_options.http_method
  status_code = aws_api_gateway_method_response.web_retrieve_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.web_retrieve_options]
}

# ---------------------------------------------------------------------------
# POST /users/signup (public)
# ---------------------------------------------------------------------------
resource "aws_api_gateway_resource" "users" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "users"
}

resource "aws_api_gateway_resource" "signup" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.users.id
  path_part   = "signup"
}

resource "aws_api_gateway_method" "post_signup" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.signup.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "signup" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.signup.id
  http_method             = aws_api_gateway_method.post_signup.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.self_signup.invoke_arn
}

resource "aws_api_gateway_method" "signup_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.signup.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "signup_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.signup.id
  http_method = aws_api_gateway_method.signup_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "signup_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.signup.id
  http_method = aws_api_gateway_method.signup_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "signup_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.signup.id
  http_method = aws_api_gateway_method.signup_options.http_method
  status_code = aws_api_gateway_method_response.signup_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.signup_options]
}

# ---------------------------------------------------------------------------
# /temp-data/* (Cognito-authorized) — presigned-URL API for the temp bucket
# (backend_temp_data.tf).
# ---------------------------------------------------------------------------
resource "aws_api_gateway_resource" "temp_data" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "temp-data"
}

# --- POST /temp-data/upload-url --------------------------------------------
resource "aws_api_gateway_resource" "upload_url" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.temp_data.id
  path_part   = "upload-url"
}

resource "aws_api_gateway_method" "post_upload_url" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.upload_url.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "upload_url" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.upload_url.id
  http_method             = aws_api_gateway_method.post_upload_url.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.get_upload_url.invoke_arn
}

resource "aws_api_gateway_method" "upload_url_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.upload_url.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "upload_url_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.upload_url.id
  http_method = aws_api_gateway_method.upload_url_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "upload_url_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.upload_url.id
  http_method = aws_api_gateway_method.upload_url_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "upload_url_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.upload_url.id
  http_method = aws_api_gateway_method.upload_url_options.http_method
  status_code = aws_api_gateway_method_response.upload_url_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.upload_url_options]
}

# --- GET /temp-data/download-url -------------------------------------------
resource "aws_api_gateway_resource" "download_url" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.temp_data.id
  path_part   = "download-url"
}

resource "aws_api_gateway_method" "get_download_url" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.download_url.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "download_url" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.download_url.id
  http_method             = aws_api_gateway_method.get_download_url.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.get_download_url.invoke_arn
}

resource "aws_api_gateway_method" "download_url_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.download_url.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "download_url_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.download_url.id
  http_method = aws_api_gateway_method.download_url_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "download_url_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.download_url.id
  http_method = aws_api_gateway_method.download_url_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "download_url_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.download_url.id
  http_method = aws_api_gateway_method.download_url_options.http_method
  status_code = aws_api_gateway_method_response.download_url_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.download_url_options]
}

# ---------------------------------------------------------------------------
# /admin/users (Cognito-authorized) — admin user-management CRUD
# (backend_auth.tf). Handlers self-enforce the Admins group; the authorizer is
# the infra half. GET->list, POST->create, PUT->update, DELETE->delete.
# ---------------------------------------------------------------------------
resource "aws_api_gateway_resource" "admin" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "admin"
}

resource "aws_api_gateway_resource" "admin_users" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.admin.id
  path_part   = "users"
}

resource "aws_api_gateway_method" "get_admin_users" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.admin_users.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "list_users" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.admin_users.id
  http_method             = aws_api_gateway_method.get_admin_users.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.list_users.invoke_arn
}

resource "aws_api_gateway_method" "post_admin_users" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.admin_users.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "create_user" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.admin_users.id
  http_method             = aws_api_gateway_method.post_admin_users.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.create_user.invoke_arn
}

resource "aws_api_gateway_method" "put_admin_users" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.admin_users.id
  http_method   = "PUT"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "update_user" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.admin_users.id
  http_method             = aws_api_gateway_method.put_admin_users.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.update_user.invoke_arn
}

resource "aws_api_gateway_method" "delete_admin_users" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.admin_users.id
  http_method   = "DELETE"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "delete_user" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.admin_users.id
  http_method             = aws_api_gateway_method.delete_admin_users.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.delete_user.invoke_arn
}

resource "aws_api_gateway_method" "admin_users_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.admin_users.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "admin_users_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.admin_users.id
  http_method = aws_api_gateway_method.admin_users_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "admin_users_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.admin_users.id
  http_method = aws_api_gateway_method.admin_users_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "admin_users_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.admin_users.id
  http_method = aws_api_gateway_method.admin_users_options.http_method
  status_code = aws_api_gateway_method_response.admin_users_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.admin_users_options]
}

# ---------------------------------------------------------------------------
# /converter/* (Cognito-authorized) — async markdown-conversion job API
# (backend_converter.tf). POST convert enqueues a job (202 + jobId); GET status
# polls the job row.
# ---------------------------------------------------------------------------
resource "aws_api_gateway_resource" "converter" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "converter"
}

# --- POST /converter/convert -----------------------------------------------
resource "aws_api_gateway_resource" "converter_convert" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.converter.id
  path_part   = "convert"
}

resource "aws_api_gateway_method" "post_converter_convert" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.converter_convert.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "converter_convert" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.converter_convert.id
  http_method             = aws_api_gateway_method.post_converter_convert.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.converter_trigger.invoke_arn
}

resource "aws_api_gateway_method" "converter_convert_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.converter_convert.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "converter_convert_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.converter_convert.id
  http_method = aws_api_gateway_method.converter_convert_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "converter_convert_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.converter_convert.id
  http_method = aws_api_gateway_method.converter_convert_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "converter_convert_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.converter_convert.id
  http_method = aws_api_gateway_method.converter_convert_options.http_method
  status_code = aws_api_gateway_method_response.converter_convert_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.converter_convert_options]
}

# --- GET /converter/status -------------------------------------------------
resource "aws_api_gateway_resource" "converter_status" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.converter.id
  path_part   = "status"
}

resource "aws_api_gateway_method" "get_converter_status" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.converter_status.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "converter_status" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.converter_status.id
  http_method             = aws_api_gateway_method.get_converter_status.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.converter_status.invoke_arn
}

resource "aws_api_gateway_method" "converter_status_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.converter_status.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "converter_status_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.converter_status.id
  http_method = aws_api_gateway_method.converter_status_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "converter_status_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.converter_status.id
  http_method = aws_api_gateway_method.converter_status_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "converter_status_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.converter_status.id
  http_method = aws_api_gateway_method.converter_status_options.http_method
  status_code = aws_api_gateway_method_response.converter_status_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.converter_status_options]
}

# ---------------------------------------------------------------------------
# /datalake/* (Cognito-authorized) — presigned-URL API for the medallion lake
# (backend_datalake.tf). Uploads always land under the caller's own bronze
# prefix; downloads are refused for any key outside it.
# ---------------------------------------------------------------------------
resource "aws_api_gateway_resource" "datalake" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "datalake"
}

# --- POST /datalake/upload-url ---------------------------------------------
resource "aws_api_gateway_resource" "datalake_upload_url" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.datalake.id
  path_part   = "upload-url"
}

resource "aws_api_gateway_method" "post_datalake_upload_url" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.datalake_upload_url.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "datalake_upload_url" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.datalake_upload_url.id
  http_method             = aws_api_gateway_method.post_datalake_upload_url.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.datalake_upload_url.invoke_arn
}

resource "aws_api_gateway_method" "datalake_upload_url_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.datalake_upload_url.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "datalake_upload_url_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.datalake_upload_url.id
  http_method = aws_api_gateway_method.datalake_upload_url_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "datalake_upload_url_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.datalake_upload_url.id
  http_method = aws_api_gateway_method.datalake_upload_url_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "datalake_upload_url_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.datalake_upload_url.id
  http_method = aws_api_gateway_method.datalake_upload_url_options.http_method
  status_code = aws_api_gateway_method_response.datalake_upload_url_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.datalake_upload_url_options]
}

# --- GET /datalake/download-url --------------------------------------------
resource "aws_api_gateway_resource" "datalake_download_url" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.datalake.id
  path_part   = "download-url"
}

resource "aws_api_gateway_method" "get_datalake_download_url" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.datalake_download_url.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "datalake_download_url" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.datalake_download_url.id
  http_method             = aws_api_gateway_method.get_datalake_download_url.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.datalake_download_url.invoke_arn
}

resource "aws_api_gateway_method" "datalake_download_url_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.datalake_download_url.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "datalake_download_url_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.datalake_download_url.id
  http_method = aws_api_gateway_method.datalake_download_url_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "datalake_download_url_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.datalake_download_url.id
  http_method = aws_api_gateway_method.datalake_download_url_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "datalake_download_url_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.datalake_download_url.id
  http_method = aws_api_gateway_method.datalake_download_url_options.http_method
  status_code = aws_api_gateway_method_response.datalake_download_url_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.datalake_download_url_options]
}

# ---------------------------------------------------------------------------
# /profile/claude-token (Cognito-authorized) — the caller's own Claude
# subscription token (backend_auth.tf). GET reports status only (never the
# token); PUT merges or removes the caller's key in the shared secret.
# ---------------------------------------------------------------------------
resource "aws_api_gateway_resource" "profile" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "profile"
}

resource "aws_api_gateway_resource" "profile_claude_token" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.profile.id
  path_part   = "claude-token"
}

resource "aws_api_gateway_method" "get_profile_claude_token" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.profile_claude_token.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "get_claude_token" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.profile_claude_token.id
  http_method             = aws_api_gateway_method.get_profile_claude_token.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.get_claude_token.invoke_arn
}

resource "aws_api_gateway_method" "put_profile_claude_token" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.profile_claude_token.id
  http_method   = "PUT"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "put_claude_token" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.profile_claude_token.id
  http_method             = aws_api_gateway_method.put_profile_claude_token.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.put_claude_token.invoke_arn
}

resource "aws_api_gateway_method" "profile_claude_token_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.profile_claude_token.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "profile_claude_token_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.profile_claude_token.id
  http_method = aws_api_gateway_method.profile_claude_token_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "profile_claude_token_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.profile_claude_token.id
  http_method = aws_api_gateway_method.profile_claude_token_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "profile_claude_token_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.profile_claude_token.id
  http_method = aws_api_gateway_method.profile_claude_token_options.http_method
  status_code = aws_api_gateway_method_response.profile_claude_token_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,PUT,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.profile_claude_token_options]
}

# ---------------------------------------------------------------------------
# /ontology/* (Cognito-authorized) — async ontology-build job API
# (ai_agents_ontology.tf). POST build starts the pipeline (202 + jobId); GET status
# polls the job row. The conversation routes are in
# backend_ontology_conversations.tf.
# ---------------------------------------------------------------------------
resource "aws_api_gateway_resource" "ontology" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "ontology"
}

# --- POST /ontology/build --------------------------------------------------
resource "aws_api_gateway_resource" "ontology_build" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.ontology.id
  path_part   = "build"
}

resource "aws_api_gateway_method" "post_ontology_build" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_build.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "ontology_build" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.ontology_build.id
  http_method             = aws_api_gateway_method.post_ontology_build.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.ontology_start.invoke_arn
}

resource "aws_api_gateway_method" "ontology_build_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_build.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "ontology_build_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ontology_build.id
  http_method = aws_api_gateway_method.ontology_build_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "ontology_build_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ontology_build.id
  http_method = aws_api_gateway_method.ontology_build_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "ontology_build_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ontology_build.id
  http_method = aws_api_gateway_method.ontology_build_options.http_method
  status_code = aws_api_gateway_method_response.ontology_build_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.ontology_build_options]
}

# --- GET /ontology/status --------------------------------------------------
resource "aws_api_gateway_resource" "ontology_status" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.ontology.id
  path_part   = "status"
}

resource "aws_api_gateway_method" "get_ontology_status" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_status.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "ontology_status" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.ontology_status.id
  http_method             = aws_api_gateway_method.get_ontology_status.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.ontology_status.invoke_arn
}

resource "aws_api_gateway_method" "ontology_status_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_status.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "ontology_status_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ontology_status.id
  http_method = aws_api_gateway_method.ontology_status_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "ontology_status_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ontology_status.id
  http_method = aws_api_gateway_method.ontology_status_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "ontology_status_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ontology_status.id
  http_method = aws_api_gateway_method.ontology_status_options.http_method
  status_code = aws_api_gateway_method_response.ontology_status_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.ontology_status_options]
}

# --- GET /ontology/builds --------------------------------------------------
resource "aws_api_gateway_resource" "ontology_builds" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.ontology.id
  path_part   = "builds"
}

resource "aws_api_gateway_method" "get_ontology_builds" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_builds.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "ontology_builds" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.ontology_builds.id
  http_method             = aws_api_gateway_method.get_ontology_builds.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.ontology_list.invoke_arn
}

resource "aws_api_gateway_method" "ontology_builds_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_builds.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "ontology_builds_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ontology_builds.id
  http_method = aws_api_gateway_method.ontology_builds_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "ontology_builds_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ontology_builds.id
  http_method = aws_api_gateway_method.ontology_builds_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "ontology_builds_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ontology_builds.id
  http_method = aws_api_gateway_method.ontology_builds_options.http_method
  status_code = aws_api_gateway_method_response.ontology_builds_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.ontology_builds_options]
}

# --- GET /ontology/builds/{jobId}/outputs ----------------------------------
resource "aws_api_gateway_resource" "ontology_build_by_id" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.ontology_builds.id
  path_part   = "{jobId}"
}

# --- DELETE /ontology/builds/{jobId} ---------------------------------------
# Tears the build down completely. Answers 202: the Lambda only marks the row and
# hands off to the purge worker, because a large build is far more objects than
# API Gateway's 29 second ceiling allows.
resource "aws_api_gateway_method" "delete_ontology_build" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_build_by_id.id
  http_method   = "DELETE"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id

  request_parameters = {
    "method.request.path.jobId" = true
  }
}

resource "aws_api_gateway_integration" "ontology_build_delete" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.ontology_build_by_id.id
  http_method             = aws_api_gateway_method.delete_ontology_build.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.ontology_delete.invoke_arn
}

# First route in this tree to take its preflight from the module rather than
# spelling the four resources out inline.
module "ontology_build_by_id_cors" {
  source = "./modules/cors"

  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_build_by_id.id
  allow_methods = "DELETE,OPTIONS"
}

# --- POST /ontology/builds/{jobId}/corpus ----------------------------------
# Adds or removes documents by deriving a NEW build from this one, so the answer is
# 202 with the new jobId and the source ontology is left untouched. Its own child
# resource rather than another method on {jobId}, because it creates rather than
# acting on the build named in the path.
resource "aws_api_gateway_resource" "ontology_build_corpus" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.ontology_build_by_id.id
  path_part   = "corpus"
}

resource "aws_api_gateway_method" "post_ontology_build_corpus" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_build_corpus.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id

  request_parameters = {
    "method.request.path.jobId" = true
  }
}

resource "aws_api_gateway_integration" "ontology_build_corpus" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.ontology_build_corpus.id
  http_method             = aws_api_gateway_method.post_ontology_build_corpus.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.ontology_update.invoke_arn
}

module "ontology_build_corpus_cors" {
  source = "./modules/cors"

  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_build_corpus.id
  allow_methods = "POST,OPTIONS"
}

# --- POST /ontology/builds/{jobId}/redrive ---------------------------------
# Completes a build that stopped short. The same Lambda as the corpus route, because
# a redrive is that derivation with the corpus held fixed: carry_forward retries only
# the documents with no markdown and the extraction plan fans out only the pages with
# no elements, so nothing that already succeeded is paid for twice.
resource "aws_api_gateway_resource" "ontology_build_redrive" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.ontology_build_by_id.id
  path_part   = "redrive"
}

resource "aws_api_gateway_method" "post_ontology_build_redrive" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_build_redrive.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id

  request_parameters = {
    "method.request.path.jobId" = true
  }
}

resource "aws_api_gateway_integration" "ontology_build_redrive" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.ontology_build_redrive.id
  http_method             = aws_api_gateway_method.post_ontology_build_redrive.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.ontology_update.invoke_arn
}

module "ontology_build_redrive_cors" {
  source = "./modules/cors"

  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_build_redrive.id
  allow_methods = "POST,OPTIONS"
}

# --- POST/DELETE /ontology/builds/{jobId}/publish --------------------------
# Shares one finished ontology with every other user, or takes it back. The method is
# the verb because the resource is the build's visibility rather than a thing being
# created: POST publishes, DELETE makes it private again. Nothing is copied either
# way, so both are one write to one row.
resource "aws_api_gateway_resource" "ontology_build_publish" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.ontology_build_by_id.id
  path_part   = "publish"
}

resource "aws_api_gateway_method" "post_ontology_build_publish" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_build_publish.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id

  request_parameters = {
    "method.request.path.jobId" = true
  }
}

resource "aws_api_gateway_integration" "ontology_build_publish" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.ontology_build_publish.id
  http_method             = aws_api_gateway_method.post_ontology_build_publish.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.ontology_publish.invoke_arn
}

resource "aws_api_gateway_method" "delete_ontology_build_publish" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_build_publish.id
  http_method   = "DELETE"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id

  request_parameters = {
    "method.request.path.jobId" = true
  }
}

resource "aws_api_gateway_integration" "ontology_build_unpublish" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.ontology_build_publish.id
  http_method             = aws_api_gateway_method.delete_ontology_build_publish.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.ontology_publish.invoke_arn
}

module "ontology_build_publish_cors" {
  source = "./modules/cors"

  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_build_publish.id
  allow_methods = "POST,DELETE,OPTIONS"
}

resource "aws_lambda_permission" "api_invoke_ontology_publish" {
  statement_id  = "AllowAPIGatewayInvokeOntologyPublish"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ontology_publish.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

# --- POST /ontology/builds/{jobId}/review ----------------------------------
# Answers the conversion review a build stops at when it loses documents. The only
# ontology route that acts on a run in flight: it sends the task token the paused
# execution is holding, with continue, stop, or a set of documents to convert again.
resource "aws_api_gateway_resource" "ontology_build_review" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.ontology_build_by_id.id
  path_part   = "review"
}

resource "aws_api_gateway_method" "post_ontology_build_review" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_build_review.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id

  request_parameters = {
    "method.request.path.jobId" = true
  }
}

resource "aws_api_gateway_integration" "ontology_build_review" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.ontology_build_review.id
  http_method             = aws_api_gateway_method.post_ontology_build_review.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.ontology_review.invoke_arn
}

module "ontology_build_review_cors" {
  source = "./modules/cors"

  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_build_review.id
  allow_methods = "POST,OPTIONS"
}

resource "aws_lambda_permission" "api_invoke_ontology_review" {
  statement_id  = "AllowAPIGatewayInvokeOntologyReview"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ontology_review.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_api_gateway_resource" "ontology_build_outputs" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.ontology_build_by_id.id
  path_part   = "outputs"
}

resource "aws_api_gateway_method" "get_ontology_build_outputs" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_build_outputs.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id

  request_parameters = {
    "method.request.path.jobId" = true
  }
}

resource "aws_api_gateway_integration" "ontology_build_outputs" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.ontology_build_outputs.id
  http_method             = aws_api_gateway_method.get_ontology_build_outputs.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.ontology_outputs.invoke_arn
}

resource "aws_api_gateway_method" "ontology_build_outputs_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_build_outputs.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "ontology_build_outputs_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ontology_build_outputs.id
  http_method = aws_api_gateway_method.ontology_build_outputs_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "ontology_build_outputs_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ontology_build_outputs.id
  http_method = aws_api_gateway_method.ontology_build_outputs_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "ontology_build_outputs_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ontology_build_outputs.id
  http_method = aws_api_gateway_method.ontology_build_outputs_options.http_method
  status_code = aws_api_gateway_method_response.ontology_build_outputs_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.ontology_build_outputs_options]
}

# --- GET /ontology/builds/{jobId}/conversations ----------------------------
# Past conversations about one ontology. Nested under the build because the build
# is the scope: the agent stores events under a composite "{sub}/{buildId}" actor,
# so a foreign jobId returns an empty list rather than another user's sessions.
resource "aws_api_gateway_resource" "ontology_build_conversations" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.ontology_build_by_id.id
  path_part   = "conversations"
}

resource "aws_api_gateway_method" "get_ontology_build_conversations" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_build_conversations.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id

  request_parameters = {
    "method.request.path.jobId" = true
  }
}

resource "aws_api_gateway_integration" "ontology_build_conversations" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.ontology_build_conversations.id
  http_method             = aws_api_gateway_method.get_ontology_build_conversations.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.ontology_conversations_list.invoke_arn
}

resource "aws_api_gateway_method" "ontology_build_conversations_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_build_conversations.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "ontology_build_conversations_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ontology_build_conversations.id
  http_method = aws_api_gateway_method.ontology_build_conversations_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "ontology_build_conversations_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ontology_build_conversations.id
  http_method = aws_api_gateway_method.ontology_build_conversations_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "ontology_build_conversations_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ontology_build_conversations.id
  http_method = aws_api_gateway_method.ontology_build_conversations_options.http_method
  status_code = aws_api_gateway_method_response.ontology_build_conversations_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.ontology_build_conversations_options]
}

# --- GET /ontology/builds/{jobId}/conversations/{sessionId} ----------------
resource "aws_api_gateway_resource" "ontology_build_conversation_by_id" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.ontology_build_conversations.id
  path_part   = "{sessionId}"
}

resource "aws_api_gateway_method" "get_ontology_build_conversation" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_build_conversation_by_id.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id

  request_parameters = {
    "method.request.path.jobId"     = true
    "method.request.path.sessionId" = true
  }
}

resource "aws_api_gateway_integration" "ontology_build_conversation_by_id" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.ontology_build_conversation_by_id.id
  http_method             = aws_api_gateway_method.get_ontology_build_conversation.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.ontology_conversations_get.invoke_arn
}

resource "aws_api_gateway_method" "ontology_build_conversation_by_id_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ontology_build_conversation_by_id.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "ontology_build_conversation_by_id_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ontology_build_conversation_by_id.id
  http_method = aws_api_gateway_method.ontology_build_conversation_by_id_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "ontology_build_conversation_by_id_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ontology_build_conversation_by_id.id
  http_method = aws_api_gateway_method.ontology_build_conversation_by_id_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "ontology_build_conversation_by_id_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ontology_build_conversation_by_id.id
  http_method = aws_api_gateway_method.ontology_build_conversation_by_id_options.http_method
  status_code = aws_api_gateway_method_response.ontology_build_conversation_by_id_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.ontology_build_conversation_by_id_options]
}

# ---------------------------------------------------------------------------
# /conversations (Cognito-authorized) — read-only proxies over the chat
# AgentCore Memory (backend_conversations.tf). GET lists the caller's sessions;
# GET /{sessionId} replays one. The handlers derive the actor from the JWT, so a
# user sees only their own conversations.
# ---------------------------------------------------------------------------
resource "aws_api_gateway_resource" "conversations" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "conversations"
}

# --- GET /conversations ----------------------------------------------------
resource "aws_api_gateway_method" "get_conversations" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.conversations.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "conversations_list" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.conversations.id
  http_method             = aws_api_gateway_method.get_conversations.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.conversations_list.invoke_arn
}

resource "aws_api_gateway_method" "conversations_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.conversations.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "conversations_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.conversations.id
  http_method = aws_api_gateway_method.conversations_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "conversations_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.conversations.id
  http_method = aws_api_gateway_method.conversations_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "conversations_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.conversations.id
  http_method = aws_api_gateway_method.conversations_options.http_method
  status_code = aws_api_gateway_method_response.conversations_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.conversations_options]
}

# --- GET /conversations/{sessionId} ----------------------------------------
resource "aws_api_gateway_resource" "conversation_by_id" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.conversations.id
  path_part   = "{sessionId}"
}

resource "aws_api_gateway_method" "get_conversation_by_id" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.conversation_by_id.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id

  request_parameters = {
    "method.request.path.sessionId" = true
  }
}

resource "aws_api_gateway_integration" "conversations_get" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.conversation_by_id.id
  http_method             = aws_api_gateway_method.get_conversation_by_id.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.conversations_get.invoke_arn
}

resource "aws_api_gateway_method" "conversation_by_id_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.conversation_by_id.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "conversation_by_id_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.conversation_by_id.id
  http_method = aws_api_gateway_method.conversation_by_id_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "conversation_by_id_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.conversation_by_id.id
  http_method = aws_api_gateway_method.conversation_by_id_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "conversation_by_id_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.conversation_by_id.id
  http_method = aws_api_gateway_method.conversation_by_id_options.http_method
  status_code = aws_api_gateway_method_response.conversation_by_id_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.conversation_by_id_options]
}

# ---------------------------------------------------------------------------
# CORS headers on authorizer / error responses (pre-integration)
# ---------------------------------------------------------------------------
resource "aws_api_gateway_gateway_response" "unauthorized" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  response_type = "UNAUTHORIZED"
  status_code   = "401"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'*'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
  }
}

resource "aws_api_gateway_gateway_response" "default_4xx" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  response_type = "DEFAULT_4XX"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'*'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
  }
}

resource "aws_api_gateway_gateway_response" "default_5xx" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  response_type = "DEFAULT_5XX"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'*'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
  }
}

# ---------------------------------------------------------------------------
# Lambda invoke permissions
# ---------------------------------------------------------------------------
resource "aws_lambda_permission" "self_signup" {
  statement_id  = "AllowAPIGatewayInvokeSignup"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.self_signup.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_random_number" {
  statement_id  = "AllowAPIGatewayInvokeRandomNumber"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.random_number.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_web_search" {
  statement_id  = "AllowAPIGatewayInvokeWebSearch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.web_search.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_web_retrieve" {
  statement_id  = "AllowAPIGatewayInvokeWebRetrieve"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.web_retrieve.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_get_upload_url" {
  statement_id  = "AllowAPIGatewayInvokeGetUploadUrl"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_upload_url.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_get_download_url" {
  statement_id  = "AllowAPIGatewayInvokeGetDownloadUrl"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_download_url.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_list_users" {
  statement_id  = "AllowAPIGatewayInvokeListUsers"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.list_users.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_create_user" {
  statement_id  = "AllowAPIGatewayInvokeCreateUser"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create_user.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_update_user" {
  statement_id  = "AllowAPIGatewayInvokeUpdateUser"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.update_user.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_delete_user" {
  statement_id  = "AllowAPIGatewayInvokeDeleteUser"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.delete_user.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_datalake_upload_url" {
  statement_id  = "AllowAPIGatewayInvokeDatalakeUploadUrl"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.datalake_upload_url.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_datalake_download_url" {
  statement_id  = "AllowAPIGatewayInvokeDatalakeDownloadUrl"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.datalake_download_url.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_get_claude_token" {
  statement_id  = "AllowAPIGatewayInvokeGetClaudeToken"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_claude_token.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_put_claude_token" {
  statement_id  = "AllowAPIGatewayInvokePutClaudeToken"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.put_claude_token.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_converter_trigger" {
  statement_id  = "AllowAPIGatewayInvokeConverterTrigger"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.converter_trigger.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_converter_status" {
  statement_id  = "AllowAPIGatewayInvokeConverterStatus"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.converter_status.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_ontology_start" {
  statement_id  = "AllowAPIGatewayInvokeOntologyStart"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ontology_start.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_ontology_status" {
  statement_id  = "AllowAPIGatewayInvokeOntologyStatus"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ontology_status.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_ontology_list" {
  statement_id  = "AllowAPIGatewayInvokeOntologyList"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ontology_list.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_ontology_outputs" {
  statement_id  = "AllowAPIGatewayInvokeOntologyOutputs"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ontology_outputs.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_ontology_delete" {
  statement_id  = "AllowAPIGatewayInvokeOntologyDelete"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ontology_delete.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_ontology_update" {
  statement_id  = "AllowAPIGatewayInvokeOntologyUpdate"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ontology_update.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_conversations_list" {
  statement_id  = "AllowAPIGatewayInvokeConversationsList"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.conversations_list.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_conversations_get" {
  statement_id  = "AllowAPIGatewayInvokeConversationsGet"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.conversations_get.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_ontology_conversations_list" {
  statement_id  = "AllowAPIGatewayInvokeOntologyConversationsList"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ontology_conversations_list.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_ontology_conversations_get" {
  statement_id  = "AllowAPIGatewayInvokeOntologyConversationsGet"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ontology_conversations_get.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

# ---------------------------------------------------------------------------
# Deployment + stage
# ---------------------------------------------------------------------------
resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  # Redeploy whenever any part of the API shape changes.
  triggers = {
    redeploy = sha1(jsonencode([
      aws_api_gateway_authorizer.cognito.id,
      aws_api_gateway_resource.random_number.id,
      aws_api_gateway_method.get_random_number.id,
      aws_api_gateway_integration.random_number.id,
      aws_api_gateway_method.random_number_options.id,
      aws_api_gateway_integration.random_number_options.id,
      aws_api_gateway_resource.web_search.id,
      aws_api_gateway_method.post_web_search.id,
      aws_api_gateway_integration.web_search.id,
      aws_api_gateway_method.web_search_options.id,
      aws_api_gateway_integration.web_search_options.id,
      aws_api_gateway_resource.web_retrieve.id,
      aws_api_gateway_method.post_web_retrieve.id,
      aws_api_gateway_integration.web_retrieve.id,
      aws_api_gateway_method.web_retrieve_options.id,
      aws_api_gateway_integration.web_retrieve_options.id,
      aws_api_gateway_resource.users.id,
      aws_api_gateway_resource.signup.id,
      aws_api_gateway_method.post_signup.id,
      aws_api_gateway_integration.signup.id,
      aws_api_gateway_method.signup_options.id,
      aws_api_gateway_integration.signup_options.id,
      aws_api_gateway_resource.temp_data.id,
      aws_api_gateway_resource.upload_url.id,
      aws_api_gateway_method.post_upload_url.id,
      aws_api_gateway_integration.upload_url.id,
      aws_api_gateway_method.upload_url_options.id,
      aws_api_gateway_integration.upload_url_options.id,
      aws_api_gateway_resource.download_url.id,
      aws_api_gateway_method.get_download_url.id,
      aws_api_gateway_integration.download_url.id,
      aws_api_gateway_method.download_url_options.id,
      aws_api_gateway_integration.download_url_options.id,
      aws_api_gateway_resource.admin.id,
      aws_api_gateway_resource.admin_users.id,
      aws_api_gateway_method.get_admin_users.id,
      aws_api_gateway_integration.list_users.id,
      aws_api_gateway_method.post_admin_users.id,
      aws_api_gateway_integration.create_user.id,
      aws_api_gateway_method.put_admin_users.id,
      aws_api_gateway_integration.update_user.id,
      aws_api_gateway_method.delete_admin_users.id,
      aws_api_gateway_integration.delete_user.id,
      aws_api_gateway_method.admin_users_options.id,
      aws_api_gateway_integration.admin_users_options.id,
      aws_api_gateway_resource.datalake.id,
      aws_api_gateway_resource.datalake_upload_url.id,
      aws_api_gateway_method.post_datalake_upload_url.id,
      aws_api_gateway_integration.datalake_upload_url.id,
      aws_api_gateway_method.datalake_upload_url_options.id,
      aws_api_gateway_integration.datalake_upload_url_options.id,
      aws_api_gateway_resource.datalake_download_url.id,
      aws_api_gateway_method.get_datalake_download_url.id,
      aws_api_gateway_integration.datalake_download_url.id,
      aws_api_gateway_method.datalake_download_url_options.id,
      aws_api_gateway_integration.datalake_download_url_options.id,
      aws_api_gateway_resource.profile.id,
      aws_api_gateway_resource.profile_claude_token.id,
      aws_api_gateway_method.get_profile_claude_token.id,
      aws_api_gateway_integration.get_claude_token.id,
      aws_api_gateway_method.put_profile_claude_token.id,
      aws_api_gateway_integration.put_claude_token.id,
      aws_api_gateway_method.profile_claude_token_options.id,
      aws_api_gateway_integration.profile_claude_token_options.id,
      aws_api_gateway_resource.converter.id,
      aws_api_gateway_resource.converter_convert.id,
      aws_api_gateway_method.post_converter_convert.id,
      aws_api_gateway_integration.converter_convert.id,
      aws_api_gateway_method.converter_convert_options.id,
      aws_api_gateway_integration.converter_convert_options.id,
      aws_api_gateway_resource.converter_status.id,
      aws_api_gateway_method.get_converter_status.id,
      aws_api_gateway_integration.converter_status.id,
      aws_api_gateway_method.converter_status_options.id,
      aws_api_gateway_integration.converter_status_options.id,
      aws_api_gateway_resource.ontology.id,
      aws_api_gateway_resource.ontology_build.id,
      aws_api_gateway_method.post_ontology_build.id,
      aws_api_gateway_integration.ontology_build.id,
      aws_api_gateway_method.ontology_build_options.id,
      aws_api_gateway_integration.ontology_build_options.id,
      aws_api_gateway_resource.ontology_status.id,
      aws_api_gateway_method.get_ontology_status.id,
      aws_api_gateway_integration.ontology_status.id,
      aws_api_gateway_method.ontology_status_options.id,
      aws_api_gateway_integration.ontology_status_options.id,
      aws_api_gateway_resource.ontology_builds.id,
      aws_api_gateway_method.get_ontology_builds.id,
      aws_api_gateway_integration.ontology_builds.id,
      aws_api_gateway_method.ontology_builds_options.id,
      aws_api_gateway_integration.ontology_builds_options.id,
      aws_api_gateway_resource.ontology_build_by_id.id,
      aws_api_gateway_method.delete_ontology_build.id,
      aws_api_gateway_integration.ontology_build_delete.id,
      module.ontology_build_by_id_cors.trigger,
      aws_api_gateway_resource.ontology_build_corpus.id,
      aws_api_gateway_method.post_ontology_build_corpus.id,
      aws_api_gateway_integration.ontology_build_corpus.id,
      module.ontology_build_corpus_cors.trigger,
      aws_api_gateway_resource.ontology_build_redrive.id,
      aws_api_gateway_method.post_ontology_build_redrive.id,
      aws_api_gateway_integration.ontology_build_redrive.id,
      module.ontology_build_redrive_cors.trigger,
      aws_api_gateway_resource.ontology_build_publish.id,
      aws_api_gateway_method.post_ontology_build_publish.id,
      aws_api_gateway_integration.ontology_build_publish.id,
      aws_api_gateway_method.delete_ontology_build_publish.id,
      aws_api_gateway_integration.ontology_build_unpublish.id,
      module.ontology_build_publish_cors.trigger,
      aws_api_gateway_resource.ontology_build_review.id,
      aws_api_gateway_method.post_ontology_build_review.id,
      aws_api_gateway_integration.ontology_build_review.id,
      module.ontology_build_review_cors.trigger,
      aws_api_gateway_resource.ontology_build_outputs.id,
      aws_api_gateway_method.get_ontology_build_outputs.id,
      aws_api_gateway_integration.ontology_build_outputs.id,
      aws_api_gateway_method.ontology_build_outputs_options.id,
      aws_api_gateway_integration.ontology_build_outputs_options.id,
      aws_api_gateway_resource.ontology_build_conversations.id,
      aws_api_gateway_method.get_ontology_build_conversations.id,
      aws_api_gateway_integration.ontology_build_conversations.id,
      aws_api_gateway_method.ontology_build_conversations_options.id,
      aws_api_gateway_integration.ontology_build_conversations_options.id,
      aws_api_gateway_resource.ontology_build_conversation_by_id.id,
      aws_api_gateway_method.get_ontology_build_conversation.id,
      aws_api_gateway_integration.ontology_build_conversation_by_id.id,
      aws_api_gateway_method.ontology_build_conversation_by_id_options.id,
      aws_api_gateway_integration.ontology_build_conversation_by_id_options.id,
      aws_api_gateway_resource.conversations.id,
      aws_api_gateway_method.get_conversations.id,
      aws_api_gateway_integration.conversations_list.id,
      aws_api_gateway_method.conversations_options.id,
      aws_api_gateway_integration.conversations_options.id,
      aws_api_gateway_resource.conversation_by_id.id,
      aws_api_gateway_method.get_conversation_by_id.id,
      aws_api_gateway_integration.conversations_get.id,
      aws_api_gateway_method.conversation_by_id_options.id,
      aws_api_gateway_integration.conversation_by_id_options.id,
      aws_api_gateway_gateway_response.unauthorized.id,
      aws_api_gateway_gateway_response.default_4xx.id,
      aws_api_gateway_gateway_response.default_5xx.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "this" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  deployment_id = aws_api_gateway_deployment.this.id
  stage_name    = local.stage

  # X-Ray active tracing — traces every request through the stage end-to-end.
  xray_tracing_enabled = true
}
