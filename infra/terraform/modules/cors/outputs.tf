output "trigger" {
  description = "Ids of the four preflight resources, for the deployment's redeploy trigger."
  value = [
    aws_api_gateway_method.options.id,
    aws_api_gateway_integration.options.id,
    aws_api_gateway_method_response.options.id,
    aws_api_gateway_integration_response.options.id,
  ]
}
