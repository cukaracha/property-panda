---
name: webapp
description:
  How the React SPA is served and deployed in this project - CloudFront (default
  *.cloudfront.net cert) in front of a private S3 bucket via Origin Access
  Control (OAC), with an SPA deep-link fallback and a build/deploy step. Use
  when changing how the SPA is hosted/served, the CloudFront distribution, the
  S3 origin, or the build/deploy step.
---

# Webapp serving & deployment

The built SPA is served by **CloudFront** in front of a **private S3 bucket**,
read via **Origin Access Control (OAC)**. The public HTTPS door is the **default
`*.cloudfront.net` certificate** - no custom domain, no ACM, no Route53.

```
browser ──https──▶ CloudFront ──(OAC, SigV4)──▶ private S3 (built assets)
        default *.cloudfront.net cert        bucket policy scoped to the distribution ARN
```

(This is the standard static-hosting pattern: CloudFront caches at the edge and
the bucket stays private - no public bucket, no proxy Lambda. This skill covers
how the app is hosted, served, and shipped, not component organization _inside_
the React app.)

## Why CloudFront + OAC

CloudFront gives the SPA an edge-cached HTTPS endpoint on the default
`*.cloudfront.net` domain under an AWS-managed certificate - nothing to
provision, validate, or renew, and no domain to own. The S3 origin bucket stays
fully private; only this one distribution can read it, granted by a **bucket
policy restricted to the distribution ARN** (`AWS:SourceArn`) for the
`cloudfront.amazonaws.com` service principal. Compared with the older
API-Gateway-+-proxy-Lambda approach, this removes a Lambda invocation per asset
and adds a real CDN edge cache.

## The pieces (all in `infra/terraform/ui_webapp.tf`)

- **Private S3 origin** - `aws_s3_bucket.webapp` with public-access-block
  (BLOCK_ALL) and `BucketOwnerEnforced`. A **bucket policy**
  (`aws_s3_bucket_policy.webapp`) grants **only** `s3:GetObject` to the
  `cloudfront.amazonaws.com` service principal, conditioned on
  `AWS:SourceArn = <distribution ARN>`. Do **not** grant `s3:ListBucket` - so a
  missing key returns **403 (AccessDenied)**, not 404 (this matters for the SPA
  fallback below).
- **Origin Access Control** - `aws_cloudfront_origin_access_control.webapp`
  (`origin_access_control_origin_type = "s3"`, `signing_behavior = "always"`,
  `signing_protocol = "sigv4"`). CloudFront uses it to SigV4-sign origin
  requests so the private bucket accepts them.
- **CloudFront distribution** - `aws_cloudfront_distribution.webapp`:
  - `default_root_object = "index.html"`;
    `viewer_protocol_policy = "redirect-to-https"`.
  - origin `domain_name = aws_s3_bucket.webapp.bucket_regional_domain_name` (the
    **regional** name - required for OAC SigV4 in `us-east-1`; the global name
    causes 307 redirect/signing issues) plus `origin_access_control_id`.
  - `cache_policy_id` = the AWS-managed **CachingOptimized** policy
    (`658327ea-f89d-4fab-a63d-7e88639e58f6`); it honors the origin
    `Cache-Control` headers we set at upload (see Build & deploy), so hashed
    assets cache for a year and `index.html` revalidates.
  - **SPA deep-link fallback** via two `custom_error_response` blocks: **403 →
    `/index.html` (200)** and **404 → `/index.html` (200)**. This replaces the
    old Lambda's "extensionless miss → index.html" logic so client-side routes
    (e.g. `/topics/<id>/lessons/<id>`) resolve on a hard refresh. The 403
    mapping is the important one (S3 answers missing keys with 403 under OAC
    without `ListBucket`).
  - `viewer_certificate { cloudfront_default_certificate = true }`;
    `price_class = "PriceClass_100"`; `wait_for_deployment = true` (so `apply`
    blocks until the distribution is Deployed).
- **Build & deploy** - `null_resource.deploy_ui` writes `.env.production` (the
  `VITE_*` values), runs `npm run build`, then publishes `dist/` to S3 in **two
  passes** so each object carries the right `Cache-Control` (now that S3 is
  served directly, the header lives on the object, not in a Lambda):
  - Pass 1 - everything **except** `index.html` with
    `--cache-control "public, max-age=31536000, immutable"` and `--delete`
    (prunes stale objects).
  - Pass 2 -
    `aws s3 cp dist/index.html ... --cache-control "no-cache" --content-type "text/html"`
    (`cp`, not `sync`, so the header re-applies even when the bytes are
    unchanged).
  - Then **`aws cloudfront create-invalidation --paths "/*"`** so the edge drops
    the old shell/routes immediately. The public URL is
    `https://${aws_cloudfront_distribution.webapp.domain_name}`, exported as the
    `webapp_url` output.

## One API Gateway remains - don't conflate it with webapp serving

CloudFront now serves the SPA; the **REST API v1**
(`infra/terraform/backend_api.tf`) is unrelated and unchanged:

|                                                    | Serves                                             | Resource                                          | Auth                      |
| -------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------- | ------------------------- |
| **CloudFront** (this skill)                        | the SPA (static assets)                            | `aws_cloudfront_distribution.webapp` + private S3 | none (public static)      |
| **REST API v1** (`infra/terraform/backend_api.tf`) | JSON endpoints (`/random-number`, `/users/signup`) | `aws_api_gateway_*` (`…-api`)                     | Cognito authorizer + CORS |

The SPA calls the REST API via `VITE_API_URL` (the REST stage `invoke_url`),
which is separate from `webapp_url`. REST CORS is
`Access-Control-Allow-Origin: '*'`, so the CloudFront origin works without any
CORS change.

## Conventions to enforce

- **Keep the bucket private** and read it **only** through CloudFront via OAC.
  The bucket policy must stay scoped to the distribution ARN (`AWS:SourceArn`) -
  never make the bucket public, and never grant a broad principal.
- **Don't grant `s3:ListBucket`** on the origin policy. Missing keys must return
  403 so the `custom_error_response` 403 → `/index.html` fallback fires.
- **Keep both `custom_error_response` blocks (403 and 404 → `/index.html`,
  200).** They are the SPA deep-link fallback; dropping the 403 one breaks
  hard-refresh on client routes.
- **Keep the cache split at upload** - `index.html` = `no-cache`, every other
  (content-hashed) asset = `public, max-age=31536000, immutable` - and **keep
  the `/*` invalidation** in the deploy step. These are what make routing and
  cache-busting correct with the edge cache.
- **Serve from the distribution root** so the SPA lives at `/` and Vite `base`
  stays `/`.
- **Use `bucket_regional_domain_name`** (not `bucket_domain_name`) for the
  origin under OAC.

## Gotchas & limits

- **Default cert only / no custom domain.** Moving to a **custom domain**
  (branded URL) is an architectural change requiring **explicit user approval**:
  it needs an **ACM cert in `us-east-1`** (CloudFront is global), an `aliases`
  entry, a non-default `viewer_certificate`, and a DNS record.
- **`apply` is slow.** `wait_for_deployment = true` makes the first `apply`
  block several minutes while the distribution propagates; the
  deploy/invalidation then runs against a Deployed distribution.
- **403, not 404, for missing keys.** Under OAC without `ListBucket`, S3 returns
  403 - hence the 403 fallback. If you ever add `ListBucket`, you'd get 404s
  (the 404 block already covers that).
- **No `forwarded_values` with `cache_policy_id`.** They're mutually exclusive;
  the managed cache policy replaces the legacy block. Don't mix OAC with
  `s3_origin_config`/OAI either.
- **Edge cache after deploy.** Even with the `/*` invalidation, a brand-new
  distribution can take a few minutes to serve globally - a runtime expectation,
  not an error.

## Verify (read-only)

```bash
cd apps/ui/web && npm run build               # type-checks the SPA build
cd infra/terraform && terraform fmt -check && terraform validate
```

> **Never run `terraform plan` / `apply` / `destroy`** - those create/change
> real infra and are the **user's** to run. An agent stops at `terraform fmt` /
> `validate` (plus `init` so `validate` can resolve providers). After the user
> applies, sanity-check: `terraform output webapp_url` loads the SPA over HTTPS,
> a hard-refresh on a deep route still loads the app (custom_error_response
> fallback), and `curl -sI <webapp_url>/index.html` shows
> `cache-control: no-cache`.
