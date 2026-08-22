# Guards for the JSON-sourced config in AppConfig.json. These values used to be
# Terraform variables (with built-in validation); now that they come from
# locals, a terraform_data precondition reproduces the hard-fail behaviour.
# (A missing or malformed AppConfig.json already fails at parse time in locals.tf.)
resource "terraform_data" "config_guards" {
  lifecycle {
    precondition {
      condition     = length(try(local.app_config.appName, "")) > 0
      error_message = "AppConfig.json must set a non-empty appName."
    }

    precondition {
      condition     = length(try(local.app_config.region, "")) > 0
      error_message = "AppConfig.json must set a non-empty region."
    }

    precondition {
      condition     = can(regex("^[a-z0-9-]+$", local.name_prefix))
      error_message = "stage + appName must be alphanumeric/hyphen only (S3/AgentCore safe). Got: ${local.name_prefix}."
    }
  }
}
