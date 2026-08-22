# Sample Agentic App

A boilerplate web application: a **React** frontend and an **AWS serverless +
Amazon Bedrock AgentCore** backend. A chat agent runs on **AgentCore Runtime**
and reaches its tools through an **AgentCore MCP Gateway** (Lambda tool targets)
and delegates to specialist **A2A** subagents; a **Bedrock Knowledge Base** (S3
Vectors) scopes answers per topic; the assistant can propose
**human-in-the-loop** page actions; and a **serverless async** pipeline converts
uploaded documents to markdown.

The whole stack is defined in **two parity infrastructure trees** — AWS **CDK**
(`infra/cdk`) and **Terraform** (`infra/terraform`) — so you can adopt either.

## Architecture

```
  Browser (React SPA, apps/ui/web)
      │  Cognito auth (Amplify)
      │
      ├── SSE ─► AgentCore Runtime ─► Chat agent (apps/ai/agents/chat)
      │                                   │
      │                                   ├─► MCP Gateway ─► Lambda tools:
      │                                   │        • course_knowledge_base (apps/ai/tools/kb)
      │                                   │        • generate_random_number (apps/ai/tools/random_number)
      │                                   └─► A2A ─► number_specialist subagent (apps/ai/agents/number_specialist)
      │
      └── REST (API Gateway, Cognito authorizer) ─► Lambdas (apps/apis):
               • /users/signup (public)      • /admin/users  (Admins only)
               • /temp-data/{upload,download}-url
               • /converter/{convert,status}  • /random-number (dual REST/gateway demo)
```

**Knowledge base:** one Bedrock KB backed by Amazon **S3 Vectors** (Titan Text
Embeddings v2, 1024-dim), one data source per topic, retrieval scoped by a
metadata filter (see [Knowledge base](#knowledge-base)).

**Converter (async):** trigger Lambda returns **202** + enqueues to an **SQS
FIFO** queue (with a DLQ); a container-image worker Lambda converts the file and
writes status to DynamoDB; the SPA polls a status endpoint (see
[Markdown converter](#markdown-converter)).

## Repository layout

| Path                                  | What                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `apps/ui/web`                         | React 19 / Vite / Tailwind v4 SPA                                          |
| `apps/ai/agents`                      | AgentCore chat agent + number_specialist subagent                          |
| `apps/ai/tools`                       | Gateway tool Lambdas (`kb`, `random_number`) + `markdown_converter` worker |
| `apps/apis`                           | REST Lambdas (`kb`, `user_management`, `temp_data`, `converter`)           |
| `apps/shared/lambda_layers/aws_utils` | Shared layer (`lambda_utils`, `auth_context`, `s3_utils`)                  |
| `infra/cdk`                           | CDK app (5 stacks: Core, Data, Ai, Api, Ui)                                |
| `infra/terraform`                     | Terraform mirror of the same infrastructure                                |
| `infra/seed`                          | KB seed corpus (`<topic>/*.md` + `*.md.metadata.json`)                     |
| `AppConfig.json`                      | Single source of environment config (loaded by both trees)                 |

## Configuration

All environment config lives in `AppConfig.json` at the repo root and is loaded
by both IaC trees (`infra/cdk/lib/config.ts`, `infra/terraform/locals.tf`).
`region` is **required** in both (fail-fast, no default), so the two trees can
never drift.

```jsonc
{
  "stage": "dev", // resource-name prefix + stack stage
  "region": "us-east-1", // REQUIRED — deploy + state-bucket region
  "appName": "sample-agentic-app",
  "displayName": "Sample Agentic App", // shown in the UI (VITE_APP_NAME)
  "domainName": "", // optional CloudFront custom domain (both trees)
  "certificateArn": "", // ACM cert ARN for the custom domain
  "allowedOrigins": ["http://localhost:3000"],
  "approvedEmailDomains": ["example.com"], // self-signup allow-list
  "seedDemoUsers": false, // when true, seeds a demo admin + user
}
```

## Deploying

> **One-tree rule.** The two trees mint **identical physical names** (Cognito
> hosted domain, S3 buckets, Lambda/SSM/IAM names). **Never apply both to the
> same account + stage.** To smoke-test Terraform alongside a CDK deploy, use a
> distinct `stage`.

All deploys are user-initiated and require AWS credentials for the target
account.

### CDK

```bash
./deploy.sh          # canonical entry point (repo root)
```

It builds the agent artifact, deploys the five stacks (Core → Data → Ai → Api →
Ui), and writes the frontend's `.env.production` from the stack outputs.
Requires `jq`.

### Terraform

Terraform keeps state in a per-app S3 object (shared, locked). One-time per
clone:

```bash
./infra/terraform/tf-init.sh     # creates/hardens the state bucket, shares the provider cache, runs terraform init
```

Then every deploy:

```bash
cd infra/terraform && terraform plan && terraform apply
```

`tf-init.sh` reads `region` from `AppConfig.json` and fails fast if it is
missing. It also points Terraform at a machine-wide provider plugin cache
(`plugin_cache_dir` in `~/.terraformrc`), so every repo shares one provider
install instead of unpacking its own copy.

## The showcase

Walk the deployed app to see every capability:

1. **Auth** — `/login` (Cognito): sign in, self-sign-up (domain-gated), reset
   password.
2. **Home** — a full-page chat with the assistant. Ask a general question; the
   tool/ reasoning timeline renders inline.
3. **Topics** (`/topics/:topicId`) — a content page rendering the seed markdown,
   with a floating assistant scoped to that topic. Ask a topic question → the
   agent calls `course_knowledge_base` with the topic filter and grounds its
   answer.
4. **A2A** — "ask the number specialist for a random number" → the chat agent
   delegates to the `number_specialist` subagent over A2A.
5. **Human-in-the-loop** — click "Open my profile" / "Convert a document"; the
   agent proposes an action; **Approve** navigates (its client-side callback
   runs) or **Reject** sends a follow-up turn.
6. **Converter** (`/converter`) — upload a file → 202 → the SPA polls → the
   converted markdown renders.
7. **Profile** (`/profile`) — edit attributes, change password (profile
   picture + delete-account are clearly-marked demos).
8. **Admin** (`/admin`, admins only) — user CRUD. Non-admins get a **403 from
   the handlers** (enforced via `aws_utils.auth_context`), not just a hidden nav
   item.

## Knowledge base

The chat agent searches a topic's materials via the `course_knowledge_base` MCP
tool (`apps/ai/tools/kb/kb.py`). The tool takes a `topicId` + `query`, maps the
topic to a Bedrock data source via the `kb-topics` DynamoDB table, and runs a
Bedrock KB `Retrieve` scoped to that data source with a metadata filter on the
reserved `x-amz-bedrock-kb-data-source-id` key — so a topic only ever sees its
own materials:

```python
retrievalConfiguration={
  'vectorSearchConfiguration': {
    'numberOfResults': top_k,
    'filter': {'equals': {'key': 'x-amz-bedrock-kb-data-source-id', 'value': data_source_id}},
  }
}
```

**Ingestion is automatic.** Seed docs live under `infra/seed/<topic>/`; a
fire-and- forget `kb-sync` Lambda (`apps/apis/kb/sync.py`) starts a Bedrock
ingestion job when a data source's docs change. Adding a topic = a new seed
folder + `*.md.metadata.json` sidecar + a data-source/registry entry — no tool
change. Check progress with:

```bash
aws bedrock-agent list-ingestion-jobs --knowledge-base-id <id> --data-source-id <id>
```

## Dual-entrypoint tool (`random_number`)

`apps/ai/tools/random_number/random_number.py` serves **both** the MCP gateway
(bare dict result) and a direct REST route (`{statusCode, body}` envelope),
branching on `lambda_utils.is_gateway_invocation`. The REST path is a demo — no
UI surface:

```bash
TOKEN=$(aws cognito-idp initiate-auth ... | jq -r .AuthenticationResult.AccessToken)
curl -H "Authorization: $TOKEN" "$VITE_API_URL/random-number"   # → {"random_number": N}
```

The same Lambda, invoked through the agent's gateway, returns a bare dict
(visible in the tool timeline / logs).

## Markdown converter

The converter (`apps/ai/tools/markdown_converter`) is a container-image worker
Lambda (LibreOffice + ffmpeg + Bedrock/OCR + Transcribe). The flow:

```
POST /converter/convert  ─► trigger: mint jobId, write 'queued', enqueue (SQS FIFO), return 202
                                              │
SQS FIFO (+ DLQ, maxReceiveCount 3) ─► worker Lambda: 'processing' → convert → 'succeeded'/'failed'
                                              │
GET /converter/status?jobId ◄── SPA poller (useSyncPoller) ── DynamoDB job table (TTL 1 day)
```

The worker's internal waits (ffmpeg, the Transcribe poll) are capped to the
Lambda's remaining time, so long media fails cleanly rather than being killed
mid-write. Images are described with Claude via Bedrock (the worker's IAM role,
no key); the Mistral OCR key comes from the `ApiKeys` Secrets Manager secret —
set its real value after the first deploy.

## Local development

```bash
npm install
npm run dev          # webapp against a deployed backend (copy apps/ui/web/.env.example → .env.local)
```

Root quality gates (husky + lint-staged + commitlint + prettier) run on commit.
See `CONTRIBUTING.md`.
