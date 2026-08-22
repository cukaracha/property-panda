locals {
  # Single source of truth — lives at repo root (Terraform runs from infra/terraform/,
  # so reach up two levels, the same idiom used for ../../apps).
  app_config = jsondecode(file("${path.module}/../../AppConfig.json"))

  stage                  = try(local.app_config.stage, "dev")
  region                 = local.app_config.region  # required — fail fast if missing (no silent default; keeps CDK/TF in the same region)
  app_name               = local.app_config.appName # required — fail fast if missing
  display_name           = try(local.app_config.displayName, local.app_config.appName)
  approved_email_domains = try(local.app_config.approvedEmailDomains, [])

  # Browser origins allowed to PUT/GET the data/temp buckets via presigned URLs
  # (mirrors config.ts allowedOrigins default).
  allowed_origins = try(local.app_config.allowedOrigins, ["http://localhost:3000"])

  # Off by default — a normal deploy seeds no users. Set true in AppConfig.json to
  # seed the demo admin + demo user (dev sample only).
  seed_demo_users = try(local.app_config.seedDemoUsers, false)

  # Optional OIDC federated identity provider. Enabled only when the block is
  # present AND both fields are non-empty — mirrors config.ts, so a config
  # without federatedIdp plans no IdP/secret and no change to the app client.
  federated_idp_raw     = try(local.app_config.federatedIdp, null)
  federated_idp_enabled = local.federated_idp_raw != null && try(local.federated_idp_raw.issuerUrl, "") != "" && try(local.federated_idp_raw.clientId, "") != ""
  federated_idp = {
    issuer_url = try(local.federated_idp_raw.issuerUrl, "")
    client_id  = try(local.federated_idp_raw.clientId, "")
  }

  # Optional custom-domain hosting for the SPA (matches the CDK ReactWebApp
  # capability). Empty domainName means no alias — the default CloudFront cert.
  domain_name       = try(local.app_config.domainName, "")
  certificate_arn   = try(local.app_config.certificateArn, "")
  use_custom_domain = local.domain_name != "" && local.certificate_arn != "" && length(regexall("cloudfront.net", local.domain_name)) == 0

  # resourcePrefix equivalent — lower() reproduces config.ts .toLowerCase().
  name_prefix = lower("${local.stage}-${local.app_name}")
}
