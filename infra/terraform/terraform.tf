terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # >= 6.22.0 is required for aws_bedrockagentcore_agent_runtime's
      # code_configuration (direct code deployment); >= 6.27.0 adds the knowledge
      # base's storage_configuration.s3_vectors_configuration (S3 Vectors store).
      version = ">= 6.27.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.4"
    }
    external = {
      source  = "hashicorp/external"
      version = ">= 2.3"
    }
  }
  # Remote state in S3. PARTIAL config — bucket/key/region are supplied at init
  # time by infra/terraform/tf-init.sh (a backend block cannot interpolate locals/vars).
  # The bucket name is derived by convention as terraform-state-<account-id>-<region>,
  # so no AppConfig field is needed. Native S3 locking (use_lockfile, TF >= 1.10) —
  # no DynamoDB. To promote to Terraform Cloud later, swap for a cloud {} block HERE only.
  backend "s3" {
    use_lockfile = true
    encrypt      = true
  }
}
