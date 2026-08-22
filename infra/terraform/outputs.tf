output "webapp_url" {
  description = "Public URL of the deployed SPA (CloudFront)."
  value       = "https://${aws_cloudfront_distribution.webapp.domain_name}"
}

output "api_base_url" {
  description = "Base invoke URL of the REST API (no trailing slash)."
  value       = aws_api_gateway_stage.this.invoke_url
}

output "user_pool_id" {
  description = "Cognito user pool id."
  value       = aws_cognito_user_pool.this.id
}

output "user_pool_client_id" {
  description = "Cognito app client id."
  value       = aws_cognito_user_pool_client.this.id
}

output "cognito_user_pool_domain_base_url" {
  description = "Cognito hosted-UI base URL (SPA OAuth redirect)."
  value       = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${local.region}.amazoncognito.com"
}

output "federated_idp_client_secret_name" {
  description = "Secrets Manager secret holding the federated IdP client secret (empty when disabled)."
  value       = local.federated_idp_enabled ? aws_secretsmanager_secret.federated_idp[0].name : ""
}

output "s3_bucket_name" {
  description = "Name of the SPA origin bucket."
  value       = aws_s3_bucket.webapp.id
}

output "aws_region" {
  description = "Region everything is deployed in."
  value       = local.region
}

output "agent_runtime_arn" {
  description = "ARN of the deployed AgentCore chat runtime (used by the SPA to invoke chat)."
  value       = aws_bedrockagentcore_agent_runtime.chat_agent.agent_runtime_arn
}

output "ontology_chat_runtime_arn" {
  description = "ARN of the AgentCore ontology retrieval runtime (used by the SPA to ask an ontology)."
  value       = aws_bedrockagentcore_agent_runtime.ontology_chat.agent_runtime_arn
}

output "gateway_url" {
  description = "MCP endpoint of the AgentCore Gateway the chat agent connects to for tools."
  value       = aws_bedrockagentcore_gateway.this.gateway_url
}

output "gateway_id" {
  description = "Id of the AgentCore Gateway exposing the tool Lambdas."
  value       = aws_bedrockagentcore_gateway.this.gateway_id
}

output "number_specialist_runtime_arn" {
  description = "ARN of the number_specialist A2A subagent runtime (also registered in SSM for orchestrator auto-discovery)."
  value       = aws_bedrockagentcore_agent_runtime.number_specialist.agent_runtime_arn
}

output "knowledge_base_id" {
  description = "Id of the Bedrock knowledge base backing the course_knowledge_base tool."
  value       = aws_bedrockagent_knowledge_base.this.id
}

output "quantum_physics_data_source_id" {
  description = "Bedrock data source id for PHYS2001 (quantum_physics) — use with list-ingestion-jobs."
  value       = aws_bedrockagent_data_source.quantum_physics.data_source_id
}

output "art_history_data_source_id" {
  description = "Bedrock data source id for ARTH1000 (art_history) — use with list-ingestion-jobs."
  value       = aws_bedrockagent_data_source.art_history.data_source_id
}
