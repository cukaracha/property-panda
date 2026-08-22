# Self-healing guard for every hash-tagged container image. Each entry maps a build to
# its ECR repo + expected tag; the probe below reports whether that image is present so
# the build's triggers_replace can force a rebuild when it is missing (interrupted push,
# deleted image, recreated repo, cross-machine state) instead of the Lambda failing later
# with "source image does not exist". To guard a new image build, add one entry here.
locals {
  ecr_image_guards = {
    web_retrieve = {
      repository = aws_ecr_repository.web_retrieve.name
      tag        = local.web_retrieve_source_hash
    }
    ontology_agent = {
      repository = aws_ecr_repository.ontology_agent.name
      tag        = local.ontology_agent_source_hash
    }
    ontology_chat = {
      repository = aws_ecr_repository.ontology_chat.name
      tag        = local.ontology_chat_source_hash
    }
    converter_worker = {
      repository = aws_ecr_repository.converter_worker.name
      tag        = local.converter_worker_source_hash
    }
  }
}

# Non-fatal ECR existence probe (one instance per guard). batch-get-image exits 0 even
# when the tag is absent (it lands in `failures`), so `length(images)` is 1 when present
# and 0 when missing; `|| echo 0` also covers a not-yet-created repo on a first apply.
# Runs with the operator's AWS creds at plan time — the aws CLI is already a hard
# dependency of this tree.
data "external" "ecr_image" {
  for_each = local.ecr_image_guards

  program = ["bash", "-c", <<-EOT
    set -euo pipefail
    n=$(aws ecr batch-get-image \
      --region ${local.region} \
      --repository-name ${each.value.repository} \
      --image-ids imageTag=${each.value.tag} \
      --query 'length(images)' --output text 2>/dev/null || echo 0)
    if [ "$n" != "0" ] && [ "$n" != "None" ]; then
      echo '{"present":"true"}'
    else
      echo '{"present":"false"}'
    fi
  EOT
  ]
}
