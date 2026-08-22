# The OPTIONS preflight quad for one API Gateway resource.
#
# REST APIs do not inherit CORS down the resource tree, so every path that a
# browser calls needs its own mock-integrated OPTIONS method. Existing routes in
# backend_api.tf still spell all four resources out inline; this module exists so
# new ones do not have to, and so their ids reach the deployment trigger as a
# single value.

resource "aws_api_gateway_method" "options" {
  rest_api_id   = var.rest_api_id
  resource_id   = var.resource_id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options" {
  rest_api_id = var.rest_api_id
  resource_id = var.resource_id
  http_method = aws_api_gateway_method.options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "options" {
  rest_api_id = var.rest_api_id
  resource_id = var.resource_id
  http_method = aws_api_gateway_method.options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options" {
  rest_api_id = var.rest_api_id
  resource_id = var.resource_id
  http_method = aws_api_gateway_method.options.http_method
  status_code = aws_api_gateway_method_response.options.status_code

  # Single-quoted: API Gateway takes these as static value expressions, not literals.
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'${var.allow_headers}'"
    "method.response.header.Access-Control-Allow-Methods" = "'${var.allow_methods}'"
    "method.response.header.Access-Control-Allow-Origin"  = "'${var.allow_origin}'"
  }

  depends_on = [aws_api_gateway_integration.options]
}
