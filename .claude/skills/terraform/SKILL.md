---
name: terraform
description:
  Terraform IaC conventions for this project plus a quick no-TFC local deploy
  reference (the user runs plan/apply, never the agent). Use when writing or
  organizing Terraform, naming AWS resources, splitting `.tf` files, passing
  references between resources, or preparing a throwaway local deploy.
---

# Terraform - conventions & local deploys

How to write, name, structure, and locally deploy Terraform here. Conventions
come first (enforce them on every change); the tested local-deploy workflow
follows.

> **Never run `terraform plan`, `terraform apply`, or `terraform destroy`.**
> They create, change, or destroy real infrastructure and may incur cost - the
> **user runs them manually**. An agent's job ends at the read-only checks
> `terraform fmt` and `terraform validate` (plus `terraform init` when needed so
> `validate` can resolve providers). The deploy section below documents those
> commands **for the user**, not for the agent to execute.

## Conventions to enforce

- **App identity comes from `AppConfig.json`** - a single JSON file at the repo
  root is the source of truth for app identity: `stage`, `region`, `appName`,
  `displayName`, and `approvedEmailDomains`. `region` is the deploy region AND
  the state-bucket region (the remote-state bucket is derived by convention, see
  Remote state below). Load it ONCE in `locals.tf` and derive everything (incl.
  `name_prefix`) from it - never hardcode these and never reintroduce a
  `var.stage` / `var.app_name` / `var.aws_region` /
  `var.approved_email_domains`:
  ```hcl
  locals {
    app_config             = jsondecode(file("${path.module}/../../AppConfig.json"))  # Terraform runs from infra/terraform/
    stage                  = try(local.app_config.stage, "dev")
    region                 = local.app_config.region            # required - no silent default
    app_name               = local.app_config.appName           # required
    approved_email_domains = try(local.app_config.approvedEmailDomains, [])
    name_prefix            = lower("${local.stage}-${local.app_name}")
  }
  ```
  Deployment knobs that are _not_ app identity - `owner`, `log_retention_days` -
  stay as Terraform `variable`s (overridable with `-var`). JSON-sourced locals
  can't use `variable validation {}`, so guard required keys with a
  `terraform_data` precondition (e.g. non-empty `appName` and `region`, an
  S3/AgentCore-safe `name_prefix`) - the loader fails fast if `region` is
  absent.
- **Resource naming** - `{stage}-{appname}-{purpose}-{type}`, all lowercase. S3
  buckets append `-{accountid}-{region}` (names are globally unique). Build
  every name from one `name_prefix` local - never repeat the stage/appname
  literal per resource:
  ```hcl
  # name = "${local.name_prefix}-{purpose}-{type}"  →  dev-myapp-temp-upload-lambda
  #         (name_prefix is derived from AppConfig.json above)
  ```
  (There is no Terraform "stack" concept, so the PascalCase stack-name rule does
  not apply.)
- **Never hardcode environment-specific values** - app identity comes from
  `AppConfig.json`; region, account id, and other env values come from variables
  / `locals` / `data` sources, never string literals in a resource.
- **Pass references, never hardcode names or ARNs** - wire resources by
  attribute (`aws_s3_bucket.x.arn`, `aws_dynamodb_table.y.name`,
  `aws_db_instance.main.endpoint`). The reference is also what creates the
  dependency edge (see Ordering below).
- **Least-privilege IAM** - scope policy `actions` and `resources` to exactly
  what's needed; avoid `"*"`. Prefer narrow `aws_iam_policy_document` statements
  over broad inline grants.
- **Python Lambda resources use `runtime = "python3.12"`.**
- **No architectural decisions without explicit user approval** - escalating
  beyond the flat layout (modules, separate states) or beyond local state
  (remote backend) changes the architecture. Describe the issue and propose
  options; let the user choose.
- **Follow the existing `.tf` patterns** in the root, and **don't add comments
  to HCL you didn't change.**

## Code structure - flat root, domain-prefixed files

Keep each root module a single flat directory; group resources by domain using
filename prefixes. **Do not nest `.tf` files in subfolders.**

- **Files in a root are cosmetic** - Terraform concatenates _every_ `*.tf` in
  the directory into one namespace → one state, one `apply`. `main.tf` is just
  convention; ordering comes from the dependency graph, not filenames.
- **Terraform does NOT recurse into subfolders** - a subfolder's `.tf` is
  ignored unless called as a module (`module "x" { source = "./x" }`). A
  subfolder is a module boundary with explicit inputs/outputs, never "just
  tidiness."

Standard layout - add a resource to the matching existing
`<domain>_<resource>.tf`; create a new file only for a genuinely new resource
group:

```
terraform.tf        # terraform {} + required_providers + backend
providers.tf        # provider "aws" etc.
variables.tf
outputs.tf
locals.tf
data.tf             # data sources
data_s3.tf      data_rds.tf          # data tier
backend_api.tf  backend_lambda.tf    # backend tier
ui_s3.tf        ui_cloudfront.tf      # ui tier
```

Escalate beyond this flat layout **only** with a concrete need and **explicit
user approval**: **modules** (`modules/<x>/` from a thin root) for genuine
reuse - e.g. a small `cors` module that collapses an `OPTIONS` preflight block
repeated across many API Gateway routes (see below) - or **separate states** for
isolation / independent lifecycle. Absent that need, stay flat.

## API Gateway REST routes - CORS-once via a reusable module + `for_each`

REST API v1 (`aws_api_gateway_*`) has **no gateway-level CORS** - methods are
matched per-resource with no inheritance, so **every path needs its own
`OPTIONS` preflight**. (HTTP API v2, `aws_apigatewayv2_*`, differs: it has a
single `cors_configuration`.) Define that preflight **once** as a small reusable
module and drive the real routes with `for_each`, so adding a route is one map
entry, not a ~40-line block. Keep the three CORS concerns separate:
**preflight** `OPTIONS` (the module below), **error-response** CORS
(`aws_api_gateway_gateway_response` for 4xx/5xx/unauthorized), and
**real-response** CORS (the headers the Lambda/app returns itself).

**The `cors` module** (`modules/cors/`; one instance = one resource's
preflight). Inputs: `rest_api_id`, `resource_id`, `allow_methods` (e.g.
`"GET,POST,OPTIONS"`), `allow_headers` (default `"Content-Type,Authorization"`),
`allow_origin` (default `"*"`). It emits the OPTIONS quad -
`aws_api_gateway_method` (`authorization = "NONE"`), a **MOCK** integration
(`{"statusCode": 200}` template), a `method_response` (200 + the three
`Access-Control-*` flags), and an `integration_response` whose header values are
**single-quoted** - and outputs a `trigger` list of its four resource ids:

```hcl
# modules/cors/ - the integration_response and output are the parts that must be exact
resource "aws_api_gateway_integration_response" "this" {
  # ... method/status wiring ...
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'${var.allow_headers}'"
    "method.response.header.Access-Control-Allow-Methods" = "'${var.allow_methods}'" # quotes required
    "method.response.header.Access-Control-Allow-Origin"  = "'${var.allow_origin}'"
  }
  depends_on = [aws_api_gateway_integration.this]
}

output "trigger" {
  value = [aws_api_gateway_method.this.id, aws_api_gateway_integration.this.id,
    aws_api_gateway_method_response.this.id, aws_api_gateway_integration_response.this.id]
}
```

**Routes via `for_each` over `locals`** - three maps per feature, then one
`for_each` each. Keep the `aws_api_gateway_resource` path nodes explicit (they
form the parent→child tree); only the methods/integrations/preflight/permissions
are generated:

```hcl
locals {
  <feature>_routes    = { create = { resource_id = aws_api_gateway_resource.x.id, http_method = "POST", invoke_arn = aws_lambda_function.create.invoke_arn } /* ... */ }
  <feature>_cors      = { x = { resource_id = aws_api_gateway_resource.x.id, allow_methods = "GET,POST,OPTIONS" } /* ... */ }
  <feature>_functions = { create = aws_lambda_function.create.function_name /* ... */ }
}

resource "aws_api_gateway_method" "<feature>" {
  for_each      = local.<feature>_routes
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = each.value.resource_id
  http_method   = each.value.http_method
  authorization = "COGNITO_USER_POOLS" # or "NONE" for a public route
  authorizer_id = aws_api_gateway_authorizer.this.id
}

resource "aws_api_gateway_integration" "<feature>" {
  for_each                = local.<feature>_routes
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = each.value.resource_id
  http_method             = aws_api_gateway_method.<feature>[each.key].http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST" # AWS_PROXY is always POST, even for GET routes
  uri                     = each.value.invoke_arn
}

module "<feature>_cors" {
  source        = "./modules/cors"
  for_each      = local.<feature>_cors
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = each.value.resource_id
  allow_methods = each.value.allow_methods
}

resource "aws_lambda_permission" "<feature>" {
  for_each      = local.<feature>_functions
  statement_id  = "AllowAPIGatewayInvoke-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = each.value
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*" # one grant covers every method/stage
}
```

**One routes file.** Collect the route blocks in a single `*_routes.tf`; file
location is cosmetic (Terraform concatenates every `*.tf`, and a resource's
address is independent of its file), so one routes file is a clean default and
re-splitting later is a no-op (zero state change).

**Derive the redeploy trigger** - don't hand-list ids. A REST
`aws_api_gateway_deployment` must redeploy when the API shape changes; build its
`triggers` from the collections so a new route **can't** be silently omitted
from the hash:

```hcl
triggers = {
  redeploy = sha1(jsonencode([
    aws_api_gateway_resource.x.id,                       # explicit path-node ids
    values(aws_api_gateway_method.<feature>)[*].id,      # all method ids
    values(aws_api_gateway_integration.<feature>)[*].id, # all integration ids
    [for m in module.<feature>_cors : m.trigger],        # all preflight ids (incl. responses)
  ]))
}
```

### Gotchas

- **Single-quote CORS header values** in the `integration_response`
  (`"'${var.allow_methods}'"`); bare values silently break CORS.
- **Copy `allow_methods` verbatim** into the map - never build it from `keys()`
  or sort it, which reorders the string (`"GET,POST,OPTIONS"` ≠
  `"GET,OPTIONS,POST"`).
- **Business methods are pure `AWS_PROXY`** - no
  `method_response`/`integration_response` pair; only the `OPTIONS` preflight
  has one (the Lambda returns real-response CORS headers itself).
- **Unique labels per feature** (`module "<feature>_cors"`,
  `aws_api_gateway_method.<feature>`) - Terraform labels are unique per resource
  type across the root.

## Quick local deploy (no Terraform Cloud) - tested ✅

Local backend = state in `./terraform.tfstate` on disk. **No `cloud {}` block,
no token, no workspace.** Throwaway tests only - _not_ for shared/real infra.
(This repo already ships an S3 backend, see **Remote state (S3 backend)** below.
The local-state template here is the generic teaching reference.)

`AppConfig.json` (repo root - app identity, the single source of truth):

```json
{
  "stage": "dev",
  "region": "us-east-1",
  "appName": "myapp",
  "displayName": "My App",
  "approvedEmailDomains": ["example.com"]
}
```

`main.tf` (root config: terraform block, provider, deploy-knob variables,
appconfig-derived name prefix):

```hcl
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.87.0" }
  }
  # no cloud {} block → local state.
  # To promote to TFC later, add a cloud {} block HERE only - resource files never change.
}

variable "owner" {
  type        = string
  description = "Owner tag applied to every resource (a team name or contact identifier)."
  # required - no default; pass it with -var 'owner=...'
}

# App identity (and the deploy region) live in AppConfig.json at the repo root; load it here and derive from it.
locals {
  app_config  = jsondecode(file("${path.module}/../../AppConfig.json"))
  stage       = try(local.app_config.stage, "dev")
  region      = local.app_config.region   # required - no silent default
  app_name    = local.app_config.appName
  name_prefix = lower("${local.stage}-${local.app_name}")
}

provider "aws" {
  region = local.region   # creds from AWS_* env vars / AWS_PROFILE

  # Tag every resource once, here - never hardcode Owner per-resource.
  default_tags {
    tags = { Owner = var.owner }
  }
}
```

`s3.tf` (the resource + its output) - name follows the convention;
`default_tags` covers Owner:

```hcl
data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "test" {
  # {stage}-{appname}-{purpose}-{type} + {accountid}-{region} for S3 global uniqueness
  bucket = "${local.name_prefix}-test-s3-${data.aws_caller_identity.current.account_id}-${local.region}"
}

output "bucket_name" { value = aws_s3_bucket.test.id }
```

Deploy - **USER-RUN ONLY.** An agent stops at `terraform validate` and must
never invoke `plan`/`apply`/`destroy`. These are documented for the user to run
manually:

```bash
aws sts get-caller-identity     # confirm the target account
terraform init                  # downloads the provider (the "dependencies")   [agent may run]
terraform validate              # [agent may run - last agent step]
terraform plan                  # USER ONLY
terraform apply                 # USER ONLY - type: yes
aws s3 ls | grep "${stage}-${app_name}"   # verify
terraform destroy               # USER ONLY - clean up, proves full lifecycle
```

- `>= 5.87.0` resolves to the latest (currently v6.x) - fine for plain
  resources; pin `~> 5.87` to stay on 5.x.
- Newer resources need a higher floor: **AgentCore (`aws_bedrockagentcore_*`)
  requires `>= 6.22.0`** for `code_configuration` - don't pin `~> 5.87` if you
  use them.
- Region comes from `AppConfig.json` (`region`), used for both the deploy and
  the state bucket. It is a required key with no silent default - the loader
  fails fast if it is absent.
- Tested with Terraform v1.15.6 on macOS (install:
  `brew install hashicorp/tap/terraform`).

## Remote state (S3 backend)

This project keeps state in S3, not on local disk. The backend block in
`infra/terraform/terraform.tf` is PARTIAL (`backend "s3" {}` with
`use_lockfile = true` and `encrypt = true`), because a backend block cannot read
`var`/`local`/`AppConfig.json`. The bucket, key, and region are supplied at init
time by `infra/terraform/tf-init.sh`, which reads `appName` and `region` from
`AppConfig.json` and derives the bucket by convention as
`terraform-state-<account-id>-<region>` (account id from
`aws sts get-caller-identity`), so no appconfig field is needed. State lives at
`s3://terraform-state-<account-id>-<region>/<appName>/terraform.tfstate` with
native S3 locking (no DynamoDB table).

Run `./tf-init.sh` in place of a plain `terraform init`:

```bash
./tf-init.sh   # creates and hardens the state bucket (versioning + AES256 + public-access-block) if missing
```

The script creates the `<appName>/` prefix on first setup. A fresh clone still
cannot run a bare `terraform apply` without first running `tf-init.sh`, because
the `.terraform/` backend config is not committed (Terraform stops with "Backend
initialization required").

`tf-init.sh` also shares one provider install across every repo on this machine:
it adds `plugin_cache_dir` to `~/.terraformrc` (once, never overriding an
existing cache) and removes any private `.terraform/providers` copy so init
re-links from that cache. Without it each clone unpacks its own copy of every
provider (~830MB, mostly the aws binary). Never add
`plugin_cache_may_break_dependency_lock_file` (unnecessary, and a one-way latch)
or `terraform providers lock -platform=...` (it dirties the committed
`.terraform.lock.hcl` on every fresh clone). The cache is not concurrency safe,
so do not run two `tf-init.sh` at once.

## Ordering & references

Resources reference each other's attributes directly - e.g. a Lambda env var set
to `aws_db_instance.main.endpoint`. **The reference creates the dependency edge,
so Terraform auto-orders** (data → backend → ui) with no manual step. Use
`depends_on` only when there is no attribute reference to create the edge.

## Hygiene

- **Tag once, centrally** - set `Owner` via provider `default_tags` from a
  required `owner` variable; never a hardcoded per-resource literal. Tags are
  written to AWS and visible account-wide (Console, CloudTrail, Cost Explorer) -
  never put a personal email in a tag.
- **Never commit state** - `.gitignore`: `.terraform/`, `*.tfstate*`. State can
  hold secrets.
- **Pass references, not secrets** - share a Secrets Manager ARN; the consumer
  resolves it at runtime.
- **Pin versions** - `required_version` + provider `version`; commit
  `.terraform.lock.hcl`.
- **Remote state with locking** → this project uses the S3 backend (see Remote
  state above): state at
  `s3://terraform-state-<account-id>-<region>/<appName>/terraform.tfstate`,
  native S3 lockfile, set up via `infra/terraform/tf-init.sh`. Changing the
  backend kind (for example to Terraform Cloud) is an architectural change - get
  user approval first.

## Gotchas

- **Provider floor.** `>= 5.87.0` resolves to v6.x and is fine for plain
  resources. Pin `~> 5.87` to stay on 5.x. AgentCore (`aws_bedrockagentcore_*`)
  needs `>= 6.22.0` for `code_configuration`.
- **Region comes from `AppConfig.json`** (`region`), via `local.region` - a
  required key with no silent default (the loader fails fast if absent). It is
  not a `-var`.
- **Python Lambda runtime** is `python3.12`.
- **Never commit state.** Add `.terraform/` and `*.tfstate*` to `.gitignore`
  (state can hold secrets).
- **Agent stops at `validate`.** Never run `plan`/`apply`/`destroy`. The user
  runs those manually.
- **AgentCore names allow underscores only.** Build them with
  `replace(local.name_prefix, "-", "_")`.
- **REST API v1 CORS is per-resource.** No gateway-level inheritance - define
  the `OPTIONS` preflight once via a `cors` module and single-quote the header
  values (see "API Gateway REST routes").
