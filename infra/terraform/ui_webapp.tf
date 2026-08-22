# UI domain — private S3 origin fronted by CloudFront (OAC) + the build/deploy step.
#
#   browser ──https──▶ CloudFront ──(OAC, SigV4)──▶ private S3 bucket (SPA assets)
#
# The bucket stays private (no public access); only this CloudFront distribution
# may read it, granted by a bucket policy scoped to the distribution ARN via OAC.
# CloudFront is the public HTTPS door. By default it uses the *.cloudfront.net
# domain + AWS-managed certificate; when AppConfig.json sets domainName +
# certificateArn it instead serves that custom alias with the supplied ACM cert
# (mirrors the CDK ReactWebApp capability — empty domainName means no alias). SPA
# deep links work because CloudFront rewrites 403/404 origin responses to
# /index.html (status 200). The SPA is built and synced (with per-asset
# Cache-Control) by null_resource.deploy_ui, which then invalidates the edge cache.

# ---------------------------------------------------------------------------
# Private origin bucket
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "webapp" {
  bucket        = "${local.name_prefix}-webapp-${data.aws_caller_identity.current.account_id}-${local.region}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "webapp" {
  bucket                  = aws_s3_bucket.webapp.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "webapp" {
  bucket = aws_s3_bucket.webapp.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# ---------------------------------------------------------------------------
# CloudFront — public HTTPS front door for the private S3 origin
# ---------------------------------------------------------------------------
# Origin Access Control — CloudFront signs (SigV4) requests to the private bucket.
resource "aws_cloudfront_origin_access_control" "webapp" {
  name                              = "${local.name_prefix}-webapp-oac"
  description                       = "OAC for the SPA origin bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "webapp" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${local.name_prefix} SPA"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  wait_for_deployment = true

  # Optional custom-domain alias (empty when domainName is unset — default cert only).
  aliases = local.use_custom_domain ? [local.domain_name] : []

  origin {
    origin_id                = "s3-webapp"
    domain_name              = aws_s3_bucket.webapp.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.webapp.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-webapp"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # AWS-managed "CachingOptimized" policy: honors the origin Cache-Control we set
    # at upload time (no-cache for index.html; immutable for hashed assets).
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  # SPA deep-link fallback. With OAC and no s3:ListBucket, S3 answers missing keys
  # with 403 (AccessDenied), not 404 — map BOTH to the app shell so client-side
  # routes (e.g. /topics/<id>/lessons/<id>) resolve on a hard refresh.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # Custom ACM cert (sni-only) when a domain is configured; otherwise the default
  # CloudFront certificate. Matches the CDK ReactWebApp behaviour.
  viewer_certificate {
    cloudfront_default_certificate = local.use_custom_domain ? null : true
    acm_certificate_arn            = local.use_custom_domain ? local.certificate_arn : null
    ssl_support_method             = local.use_custom_domain ? "sni-only" : null
    minimum_protocol_version       = local.use_custom_domain ? "TLSv1.2_2021" : null
  }
}

# Bucket policy — only this distribution (via OAC) may read objects. The Service
# principal + AWS:SourceArn condition is not "public", so block_public_policy=true
# accepts it.
data "aws_iam_policy_document" "webapp_bucket" {
  statement {
    sid       = "AllowCloudFrontServicePrincipalReadOnly"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.webapp.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.webapp.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "webapp" {
  bucket     = aws_s3_bucket.webapp.id
  policy     = data.aws_iam_policy_document.webapp_bucket.json
  depends_on = [aws_s3_bucket_public_access_block.webapp]
}

# ---------------------------------------------------------------------------
# Build the SPA with the live config, sync to S3, invalidate the edge cache
# ---------------------------------------------------------------------------
resource "null_resource" "deploy_ui" {
  triggers = {
    bucket                = aws_s3_bucket.webapp.id
    user_pool_id          = aws_cognito_user_pool.this.id
    client_id             = aws_cognito_user_pool_client.this.id
    api_url               = aws_api_gateway_stage.this.invoke_url
    agent_runtime_arn     = aws_bedrockagentcore_agent_runtime.chat_agent.agent_runtime_arn
    ontology_runtime_arn  = aws_bedrockagentcore_agent_runtime.ontology_chat.agent_runtime_arn
    app_display_name      = local.display_name
    federated_idp_enabled = tostring(local.federated_idp_enabled)
    src_hash              = sha1(join("", [for f in fileset("${path.module}/../../apps/ui/web/src", "**") : filemd5("${path.module}/../../apps/ui/web/src/${f}")]))
    package_hash          = filemd5("${path.module}/../../apps/ui/web/package.json")
    index_hash            = filemd5("${path.module}/../../apps/ui/web/index.html")
  }

  provisioner "local-exec" {
    working_dir = "${path.module}/../../apps/ui/web"
    interpreter = ["bash", "-c"]

    environment = {
      VITE_AWS_REGION            = local.region
      VITE_USER_POOL_ID          = aws_cognito_user_pool.this.id
      VITE_USER_POOL_CLIENT_ID   = aws_cognito_user_pool_client.this.id
      VITE_API_URL               = aws_api_gateway_stage.this.invoke_url
      VITE_AGENTCORE_RUNTIME_ARN = aws_bedrockagentcore_agent_runtime.chat_agent.agent_runtime_arn
      # The ontology page invokes its own retrieval runtime directly, the same
      # way the chat page invokes the chat runtime.
      VITE_ONTOLOGY_AGENT_RUNTIME_ARN = aws_bedrockagentcore_agent_runtime.ontology_chat.agent_runtime_arn
      VITE_APP_NAME                   = local.display_name
      # Bare Cognito hosted-UI host (no scheme) — empty unless a federated IdP is
      # configured; its presence turns on the SPA SSO button.
      VITE_COGNITO_DOMAIN = local.federated_idp_enabled ? "${aws_cognito_user_pool_domain.this.domain}.auth.${local.region}.amazoncognito.com" : ""
      DEPLOY_BUCKET       = aws_s3_bucket.webapp.id
      WEBAPP_URL          = "https://${aws_cloudfront_distribution.webapp.domain_name}"
      DISTRIBUTION_ID     = aws_cloudfront_distribution.webapp.id
    }

    command = <<-EOT
      set -euo pipefail
      {
        echo "VITE_AWS_REGION=$VITE_AWS_REGION"
        echo "VITE_USER_POOL_ID=$VITE_USER_POOL_ID"
        echo "VITE_USER_POOL_CLIENT_ID=$VITE_USER_POOL_CLIENT_ID"
        echo "VITE_API_URL=$VITE_API_URL"
        echo "VITE_AGENTCORE_RUNTIME_ARN=$VITE_AGENTCORE_RUNTIME_ARN"
        echo "VITE_ONTOLOGY_AGENT_RUNTIME_ARN=$VITE_ONTOLOGY_AGENT_RUNTIME_ARN"
        echo "VITE_APP_NAME=$VITE_APP_NAME"
      } > .env.production

      # Append only when a federated IdP is configured — its presence is what
      # turns on the SPA SSO button.
      if [ -n "$VITE_COGNITO_DOMAIN" ]; then
        echo "VITE_COGNITO_DOMAIN=$VITE_COGNITO_DOMAIN" >> .env.production
      fi

      # Mirror the live config into a dev-loadable file so `npm run dev` (Vite
      # development mode) works after an apply — Vite reads .env.production only
      # for `npm run build`. .env.local is loaded in every mode and gitignored.
      cp .env.production .env.local
      npm install
      npm run build

      # Pass 1: hashed/immutable assets (everything except index.html).
      # --delete prunes objects no longer in dist/.
      aws s3 sync dist/ "s3://$DEPLOY_BUCKET/" \
        --delete --region "$VITE_AWS_REGION" \
        --exclude "index.html" \
        --cache-control "public, max-age=31536000, immutable"

      # Pass 2: the app shell — always revalidate. cp (not sync) so the header is
      # re-applied even when index.html's bytes are unchanged.
      aws s3 cp dist/index.html "s3://$DEPLOY_BUCKET/index.html" \
        --region "$VITE_AWS_REGION" \
        --cache-control "no-cache" --content-type "text/html"

      # Drop the old shell / cached routes from the edge immediately.
      aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*"

      echo ""
      echo "=================================================================="
      echo "  SPA deployed: $WEBAPP_URL"
      echo "=================================================================="
    EOT
  }

  depends_on = [
    aws_cloudfront_distribution.webapp,
    aws_s3_bucket_policy.webapp,
    aws_api_gateway_stage.this,
    aws_lambda_permission.self_signup,
  ]
}
