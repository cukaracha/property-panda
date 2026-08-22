# Rules

- Follow existing code patterns and conventions in the codebase.
- Do not add comments, docstrings, or type annotations to code you didn't
  change.
- Prefer editing existing files over creating new ones.
- Python Lambda functions use Python 3.12.
- Strictly forbidden from making architectural decisions without explicit
  approval by the user. If you encounter such issues, briefly describe the issue
  and propose options for the user to choose from.
- Before writing a plan, search the skills-gateway MCP for relevant skills, read
  each match, and list them in the plan. The gateway is authoritative over any
  local skills copy.

# Project Overview

A web application with a React frontend (`apps/ui/web`) and an AWS serverless +
Bedrock AgentCore backend. The chat agent runs on AgentCore Runtime and reaches
its tools through an AgentCore MCP Gateway (Lambda tool targets) plus A2A
subagents; a Bedrock Knowledge Base (S3 Vectors) scopes answers per topic.

The infrastructure is defined in **two parity trees** — CDK (`infra/cdk`) and
Terraform (`infra/terraform`) — split into five stacks/layers: Core
(auth/secrets), Data (DynamoDB/S3/KB), Ai (AgentCore runtime/gateway/tools), Api
(API Gateway/Lambdas), and Ui (S3/CloudFront).

Configuration lives in `AppConfig.json` at the project root, loaded via
`infra/cdk/lib/config.ts` (CDK) and `infra/terraform/locals.tf` (Terraform).
`region` is required in both loaders (fail-fast, no default) so the two trees
can never drift.

# Development Guide

## Infrastructure (both trees)

- **Every infrastructure change lands in BOTH `infra/cdk` and
  `infra/terraform`.** Author the CDK change first, then mirror it in Terraform
  before the work is "done".
- The two trees mint identical physical resource names, so **never apply both to
  the same account + stage** — Terraform smoke-deploys use a distinct `stage`.

## CDK

- Stacks never define AWS resources inline — they only instantiate constructs.
- Constructs go in domain folders under `infra/cdk/lib/constructs/` (`core/`,
  `shared/`, `data/`, `ai/`, `api/`, `ui/`).
- Pass resource references as typed props between stacks/constructs. Never
  hardcode table names, bucket names, or ARNs.
- Use CDK grant methods (`table.grantReadData()`, `bucket.grantReadWrite()`)
  over manual `iam.PolicyStatement`.
- Environment-specific values live in `AppConfig.json` and are loaded via
  `infra/cdk/lib/config.ts`. Never hardcode them in stacks or constructs.
- Resource names use the format `{stage}-{appname}-{purpose}-{type}`, all
  lowercase. S3 buckets add `-{accountid}-{region}` suffix. Stack names use
  PascalCase: `{stage}-{appName}-{StackName}`. Use `resourcePrefix` from config
  for the `{stage}-{appname}` portion.

## Web App

- Use reusable components from `components/` wherever possible. When a component
  is page-specific, place it in `pages/<page>/components/`.
- Pages must not define inline components — always use reusable or page-specific
  components.
- A page folder can optionally contain subdirectories for `utils/`, `hooks/`,
  and `types/` when needed.

## Lambda Functions

- Include a docstring at the top of each Lambda file briefly describing what the
  function does.
- `lambda_handler` only parses the request and formats the response, then
  delegates to `main()`.
- `main()` acts as the orchestrator — it calls helper/utility functions to
  execute the workflow. Keep business logic out of the handler.
- Use the `aws_utils` Lambda layer for standard CORS and OPTIONS handling. Call
  `lambda_utils.handle_options(event)` at the top of the handler and use
  `lambda_utils.success_response()` / error helpers for responses.

## Lambda Layers

Shared layers live under `apps/shared/lambda_layers/`. A layer is a plain
`python/` tree — **no build step, no committed zip.** The IaC zips the directory
at deploy time (CDK `Code.fromAsset`, Terraform `archive_file`) and publishes
the version; consumers resolve its ARN from SSM
(`/{prefix}/layers/aws-utils-arn`).

```
<layer_name>/
└── python/
    └── <layer_name>/       # importable package
        ├── __init__.py
        ├── module1.py
        └── module2.py
```

Keep layer modules **zero-dependency** (standard library + `boto3`, which the
Lambda runtime already provides). The `aws_utils` layer ships `lambda_utils`
(CORS/OPTIONS + response helpers), `auth_context` (Cognito group/claim
extraction), and `s3_utils` (presigned URLs).

## APIs

- Lambda functions are organized by domain, with CRUD verb subfolders under
  `apps/apis/`.
- Example: `apps/apis/autograder/create/create_autograder.py`.

## Async tools (serverless)

Long-running tools (e.g. the markdown converter) use the async pattern: a
trigger Lambda returns **202** + enqueues to an SQS FIFO queue (with a DLQ); a
container-image worker Lambda processes the job and writes status to a DynamoDB
table; a status endpoint is polled by the frontend (`useSyncPoller`). See
`apps/ai/tools/markdown_converter/` and `apps/apis/converter/`.
