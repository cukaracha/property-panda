# web_retrieve tool — fetch one URL and return clean markdown, rendered with a
# real headless browser (Crawl4AI + Playwright/Chromium). Mirrors the CDK
# WebRetrieveTool construct (infra/cdk/lib/constructs/ai/tools/WebRetrieveTool.ts)
# — an x86_64 container-image Lambda based on the upstream unclecode/crawl4ai
# image (Chromium + deps prebuilt) plus the Lambda Runtime Interface Client; see
# apps/ai/tools/web_retrieve/Dockerfile. Dual-entrypoint: registered as the
# `web_retrieve` AgentCore Gateway MCP target (ai_gateway.tf) AND fronted by a
# Cognito-authorized REST route (backend_api.tf). Keyless/self-hosted (no secret,
# no Bedrock); minimal IAM (Logs only). The crawl4ai base image is large and slow
# to build/push the first time.

locals {
  web_retrieve_dir = "${path.module}/../../apps/ai/tools/web_retrieve"

  # Hash every source file under the tool dir (excluding generated __pycache__),
  # so a code change yields a new immutable image tag that busts Lambda's image cache.
  web_retrieve_files = sort([
    for f in fileset(local.web_retrieve_dir, "**/*") : f
    if !strcontains(f, "__pycache__")
  ])

  web_retrieve_source_hash = sha1(join("", [
    for f in local.web_retrieve_files : filesha256("${local.web_retrieve_dir}/${f}")
  ]))

  web_retrieve_image_uri = "${aws_ecr_repository.web_retrieve.repository_url}:${local.web_retrieve_source_hash}"
}

# ---------------------------------------------------------------------------
# ECR repository — holds the web_retrieve container image
# ---------------------------------------------------------------------------
resource "aws_ecr_repository" "web_retrieve" {
  name = "${local.name_prefix}-web-retrieve"

  # MUTABLE so a re-push of the same hash tag (rare) doesn't error; force_delete
  # lets `terraform destroy` remove the repo with images present.
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

# ---------------------------------------------------------------------------
# Build & push the x86_64 image — only when the tool's sources change
# ---------------------------------------------------------------------------
resource "terraform_data" "web_retrieve_build" {
  # Rebuild+push when the tool source changes (hash), the marker is bumped, the ECR
  # image is missing (self-healing guard), or the shared build helper changes.
  triggers_replace = [
    local.web_retrieve_source_hash,
    "v1",
    data.external.ecr_image["web_retrieve"].result.present,
    filesha256("${path.module}/../../scripts/build_container_image.sh"),
  ]

  # linux/amd64 → ECR (hash tag) via the shared, cache-capped buildx builder.
  provisioner "local-exec" {
    command = "${path.module}/../../scripts/build_container_image.sh --context ${local.web_retrieve_dir} --tag ${local.web_retrieve_image_uri}"
  }

  depends_on = [aws_ecr_repository.web_retrieve]
}

# ---------------------------------------------------------------------------
# IAM — Logs only (keyless, no Bedrock)
# ---------------------------------------------------------------------------
resource "aws_iam_role" "web_retrieve_exec" {
  name               = "${local.name_prefix}-web-retrieve-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "web_retrieve_permissions" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
  }
}

resource "aws_iam_role_policy" "web_retrieve_permissions" {
  name   = "${local.name_prefix}-web-retrieve-policy"
  role   = aws_iam_role.web_retrieve_exec.id
  policy = data.aws_iam_policy_document.web_retrieve_permissions.json
}

resource "aws_cloudwatch_log_group" "web_retrieve" {
  name              = "/aws/lambda/${local.name_prefix}-web-retrieve-tool"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "web_retrieve" {
  function_name = "${local.name_prefix}-web-retrieve-tool"
  package_type  = "Image"
  image_uri     = local.web_retrieve_image_uri
  role          = aws_iam_role.web_retrieve_exec.arn
  architectures = ["x86_64"]
  timeout       = 180
  memory_size   = 3008

  image_config {
    command = ["web_retrieve.lambda_handler"]
  }

  ephemeral_storage {
    size = 2048 # Chromium user-data-dir + browser cache under /tmp
  }

  depends_on = [
    terraform_data.web_retrieve_build,
    aws_iam_role_policy.web_retrieve_permissions,
    aws_cloudwatch_log_group.web_retrieve,
  ]
}