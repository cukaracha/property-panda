---
name: cdk
description:
  AWS CDK (TypeScript) IaC conventions for this project - the 5-stack layout
  (core/data/ai/api/ui), construct organization, cross-stack sharing (typed
  props vs SSM), AgentCore/Bedrock/S3-Vectors construct choices, and the
  deploy.sh workflow (the user runs cdk deploy, never the agent). Use when
  writing or organizing CDK code in infra/cdk/, adding a stack or construct,
  passing references between stacks, mapping a resource to a stack, or preparing
  a CDK deploy.
---

# CDK - conventions & the 5-stack app

How to write, name, structure, and deploy the CDK app in `infra/cdk/`. It is the
alternative IaC path to `infra/terraform/` - both deploy the same architecture
and both read the root `AppConfig.json`.

> **Never run `cdk deploy` or `cdk destroy`.** They create, change, or destroy
> real infrastructure and may incur cost - the **user runs them manually**
> (usually via the repo-root `deploy.sh`). An agent's job ends at the read-only
> checks `npx tsc --noEmit` and `npx cdk synth`. The deploy section below
> documents the commands **for the user**.

## Conventions to enforce

- **App identity comes from `AppConfig.json`** (repo root, shared with
  Terraform): `stage`, `region`, `appName`, `displayName`,
  `approvedEmailDomains`. Loaded ONCE by `infra/cdk/lib/config.ts`
  (`path.join(__dirname, '../../../AppConfig.json')`), which derives
  `resourcePrefix = ${stage}-${appName}`.toLowerCase()` and the five stack
  names. Never hardcode these in stacks or constructs.
- **Stacks never define AWS resources inline** - they only instantiate
  constructs and wire props. All resources live in constructs.
- **Constructs go in domain folders** under
  `lib/constructs/{core,data,ai,api,ui}/` as PascalCase files (`Cognito.ts`,
  `KbTool.ts`). The `ai/` domain has two subfolders: `ai/tools/` (knowledge
  base, vector store, tool Lambdas) and `ai/agents/` (MCP gateway, AgentCore
  runtimes).
- **Pass typed props between stacks** in `bin/infra.ts` and call
  `addDependency()` for ordering. Never hardcode table names, bucket names, or
  ARNs. (Exceptions where a CloudFormation export would hurt - see Cross-stack
  sharing below.)
- **Prefer grant methods** (`table.grantReadData(fn)`, `bucket.grantRead(role)`)
  over manual `iam.PolicyStatement`; fall back to statements only for actions
  with no grant helper (e.g. `bedrock:Retrieve`, `cognito-idp:AdminCreateUser`).
- **Resource naming** - `{stage}-{appname}-{purpose}-{type}`, all lowercase,
  built from `resourcePrefix`. S3 buckets append `-{account}-{region}`. Stack
  names are PascalCase `{stage}-{appName}-XxxStack`. **AgentCore
  runtime/memory/credential-provider names allow underscores only** - build them
  with `resourcePrefix.replace(/-/g, '_')`; gateway names allow hyphens (not
  underscores).
- **Python Lambdas use `lambda.Runtime.PYTHON_3_12`** with a thin
  `lambda_handler` → `main()` (handler code is shared with the Terraform path).
- **No architectural decisions without explicit user approval** - new stacks,
  moving a resource between stacks, or changing how values cross stacks.
  Describe the issue and propose options; let the user choose.

## The 5 stacks and what lives where

| Stack         | Constructs                                                                                                                                                                                                                                                                                                                                                                                                                                  | Notes                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **CoreStack** | `core/Cognito` (pool, app client, hosted-UI domain, `gateway` resource server + `invoke` scope, secret M2M client `gateway-m2m`, Admins/Users groups), `core/LambdaLayers` (aws_utils layer → SSM), `core/UserManagement` (self_signup Lambda)                                                                                                                                                                                              | Outputs `UserPoolId`, `UserPoolClientId`                                                     |
| **DataStack** | `data/KbSourceBucket`                                                                                                                                                                                                                                                                                                                                                                                                                       | ONLY the KB source-docs bucket; seed upload + data sources are owned by the AI stack         |
| **AiStack**   | `ai/tools/VectorStore` (S3 Vectors bucket + index), `ai/tools/KbTopicsTable`, `ai/tools/KnowledgeBase` (KB + seed upload + data sources + kb_sync + ingestion triggers), `ai/tools/KbTool`, `ai/tools/RandomNumberTool`, `ai/agents/McpGateway` (gateway + targets + OAuth2 credential provider), `ai/agents/ChatAgent` (memory + artifact bucket + zip runtime), `ai/agents/NumberSpecialist` (A2A container runtime + SSM registry entry) | Outputs `ChatAgentRuntimeArn`, `GatewayUrl`, `KnowledgeBaseId`, `NumberSpecialistRuntimeArn` |
| **ApiStack**  | `api/ApiGateway` (GET /random-number - Cognito; POST /users/signup - public; CORS gateway responses)                                                                                                                                                                                                                                                                                                                                        | `random_number` Lambda is OWNED by AiStack, wired here as a prop                             |
| **UiStack**   | `ui/ReactWebApp` (private bucket + OAC + CloudFront + build/deploy)                                                                                                                                                                                                                                                                                                                                                                         | Outputs `CloudFrontUrl`                                                                      |

Dependency edges (acyclic):
`ai→core, ai→data, api→core, api→ai, ui→core, ui→api`. Deploy order: core, data,
ai, api, ui.

## Exotic-resource cheat sheet (hard-won)

- **`aws-cdk-lib >= 2.261.0`** - the AgentCore L2s are STABLE in
  `aws-cdk-lib/aws-bedrockagentcore` (graduated from
  `@aws-cdk/aws-bedrock-agentcore-alpha`; do not add the alpha package).
  Requires `typescript >= 5.2` (`~5.6`) and `skipLibCheck: true` (its `.d.ts`
  uses `Disposable`).
- **AgentCore Runtime (zip)**: `new agentcore.Runtime` +
  `AgentRuntimeArtifact.fromS3({bucketName, objectKey}, AgentCoreRuntime.PYTHON_3_12, ['main.py'])` +
  `RuntimeAuthorizerConfiguration.usingCognito(pool, [client])` +
  `RuntimeNetworkConfiguration.usingPublicNetwork()`. Upload the pre-built
  `apps/ai/agents/chat/build/agent.zip` with a `BucketDeployment` under a
  `chat_agent/${codeHash}/` prefix — hash the agent sources
  (`cdk.FileSystem.fingerprint(src, {exclude: ['build']})`) AND
  `apps/ai/agents/build_agent.sh` (Terraform hashes both) — so each code version
  gets a unique key (busts AgentCore's S3-zip cache), set
  `CODE_VERSION: codeHash` in env, and
  `runtime.node.addDependency(bucketDeployment)`.
- **AgentCore Runtime (A2A container)**:
  `AgentRuntimeArtifact.fromAsset(dir, {platform: ecrAssets.Platform.LINUX_ARM64})` +
  `protocolConfiguration: agentcore.ProtocolType.A2A`. No dedicated ECR repo or
  build script - the CDK asset URI changes per content hash. Register the
  runtime ARN as an `ssm.StringParameter` at
  `/{resourcePrefix}/a2a-subagents/<name>`.
- **MCP Gateway**: `new agentcore.Gateway` +
  `GatewayAuthorizer.usingCognito({userPool, allowedClients: [appClient, m2mClient]})`;
  then REMOVE the protocol config via the L1 escape hatch — the L2's default
  injects a semantic-search tool + pins protocol versions (Terraform sets
  neither), and `GatewayProtocol.mcp({})` is rejected at deploy ("MCP
  configuration cannot be empty"), while the CFN property is optional:
  `(gateway.node.defaultChild as agentcore.CfnGateway).addPropertyDeletionOverride('ProtocolConfiguration')`.
  Targets via `GatewayTarget.forLambda` + `ToolSchema.fromInline([...])`
  (`SchemaDefinitionType.OBJECT/STRING/NUMBER`) +
  `GatewayCredentialProvider.fromIamRole()`. The L2 auto-grants
  `lambda.grantInvoke` on the gateway role; keep the resource-based
  `fn.addPermission` (principal `bedrock-agentcore.amazonaws.com`,
  `sourceArn: gateway.gatewayArn`) as belt-and-suspenders.
- **OAuth2 credential provider (M2M)**:
  `agentcore.OAuth2CredentialProvider.usingCustom` with `clientId`,
  `clientSecret: SecretValue`, `discoveryUrl` (Cognito OIDC).
- **AgentCore Memory**:
  `new agentcore.Memory({memoryName, expirationDuration: Duration.days(30)})`.
- **Knowledge base**: L1 `bedrock.CfnKnowledgeBase` with
  `storageConfiguration: {type: 'S3_VECTORS', s3VectorsConfiguration: {indexArn}}`
  and Titan v2 (`dimensions: 1024`, `embeddingDataType: 'FLOAT32'`); data
  sources via L1 `bedrock.CfnDataSource` (S3 + `inclusionPrefixes`).
- **S3 Vectors**: L1 `s3vectors.CfnVectorBucket` + `CfnIndex`
  (`vectorBucketArn` - not name, `dataType: 'float32'`, `dimension: 1024`,
  `distanceMetric: 'cosine'`,
  `metadataConfiguration.nonFilterableMetadataKeys: ['AMAZON_BEDROCK_TEXT', 'AMAZON_BEDROCK_METADATA']`).
- **Behavioral steps** (KB ingestion trigger, `topicId→dataSourceId` DDB items,
  Cognito secret fetch) use `cr.AwsCustomResource`. For ingestion, bake the
  course docs hash (`cdk.FileSystem.fingerprint(seed/<course>)`) into the call
  payload so a seed change re-fires only that course's sync.

## Cross-stack sharing patterns

Default is **typed props** in `bin/infra.ts` (+ `addDependency`) - CDK turns
them into CloudFormation exports. Four references are deliberately NOT plain
exports:

1. **`aws_utils` Lambda layer (core → ai): via SSM.** An export can't change
   while imported, which would block re-publishing the layer. Core publishes
   `/{resourcePrefix}/layers/aws-utils-arn` (`ssm.StringParameter`); AI reads it
   with `ssm.StringParameter.valueForStringParameter(this, ...)` +
   `lambda.LayerVersion.fromLayerVersionArn(...)` (synthesizes an
   `AWS::SSM::Parameter::Value<String>` template parameter, resolved at deploy
   time). SSM creates no ordering edge - keep the explicit
   `ai.addDependency(core)`.
2. **Cognito M2M client secret: never export it.** Fetch it in the CONSUMING
   stack via `AwsCustomResource` `cognito-idp:DescribeUserPoolClient`, then
   `cdk.SecretValue.resourceAttribute(fetcher.getResponseField('UserPoolClient.ClientSecret'))`.
   Do NOT use `userPoolClient.userPoolClientSecret` across stacks - that would
   export the secret value.
3. **Chat runtime ARN → UI: via deploy.sh**, which writes
   `apps/ui/web/.env.production` from CFN outputs before deploying UI. Avoids a
   `ui→ai` edge and a UI redeploy on every AI change.
4. **A2A subagent registry: SSM at runtime.** The chat agent reads
   `/{resourcePrefix}/a2a-subagents/*` per request - deliberately no CDK edge,
   so adding a subagent never redeploys chat.

## Build & deploy - the repo-root `deploy.sh` (USER-RUN)

Follows the `samples/blacklight/deploy.sh` skeleton: `set -e`/`set -x`,
`show_error` trap, `jq` parse of the root `AppConfig.json`, one
`deploy_<stack>()` per stack
(`npx cdk deploy "$STACK" --exclusively --require-approval never` — `npx` so the
repo-local CLI pinned in package.json is used, never a stale global),
`update_env_file()` reading CFN outputs (`UserPoolId`, `UserPoolClientId`,
`ApiEndpoint`, `ChatAgentRuntimeArn`) into `apps/ui/web/.env.production`
(`VITE_*` vars), a phased `main()` (core → data → ai → api → env-file → ui), and
`profile=`/`stack=` args (`core|data|ai|api|ui|all`).

- `deploy_ai` always rebuilds the agent zip
  (`apps/ai/agents/build_agent.sh chat` → `apps/ai/agents/chat/build/agent.zip`,
  gitignored); every other `deploy_*` calls `ensure_agent_zip` because
  `bin/infra.ts` constructs ALL stacks on any cdk command, so the zip must exist
  to synth even CoreStack.
- Docker must be running for `deploy_ai` (ARM64 subagent image asset).

```bash
cd infra/cdk
npm install
npx cdk synth        # [agent may run - last agent step]
./deploy.sh          # USER ONLY (or ./deploy.sh stack=ai, profile=dev ...)
```

## Gotchas

- **"Cloud assembly schema version mismatch" = stale CDK CLI.** aws-cdk-lib
  2.261.0 emits schema 54, which needs CLI >= 2.1129.0. Always run `npx cdk ...`
  from `infra/cdk/` (resolves the pinned local CLI), not a global `cdk` binary.
- **GatewayTarget fails with "Gateway execution role lacks permission to invoke
  Lambda"**: AgentCore validates invoke permission at target-CREATE time, but
  the L2's internal `grantInvoke(gateway.role)` discards its Grant — no
  DependsOn orders the role policy before the target. Sequence explicitly:
  `target.node.addDependency(gateway.role)` (covers the role's DefaultPolicy
  child) plus a dependency on each tool's `addPermission` child.
- **AiStack create-failure rollbacks can end ROLLBACK_FAILED** on the Memory
  ("transitional state CREATING") — a resource-handler race, not a code bug.
  Once the Memory finishes creating, `aws cloudformation delete-stack` succeeds;
  then redeploy.
- **BucketDeployment of any artifact beyond a few MB needs `memoryLimit`
  raised** (the agent zip uses 1024). The handler's Python baseline is ~97 MB of
  the default 128 MB; syncing a ~47 MB zip OOM-freezes it SILENTLY — no error,
  no "Task timed out", just CloudFormation failing ~1 h later with "did not
  receive a response from your Custom Resource". CDK creates a separate handler
  per memoryLimit value, so small deployments (seed docs) keep the default.
- **Webapp must build on the HOST, not in Docker.** The webapp's `@seed` alias
  resolves to `../../infra/seed` - outside the asset root, unreachable from a
  container mount. `ReactWebApp` uses a `local: {tryBundle}` bundling provider
  (`npm install && npm run build` in `apps/ui/web`,
  `fs.cpSync(dist, outputDir)`); the Docker image is a formal fallback only.
- **`apps/ai/agents/chat/build/` contains an unpacked `package/` dir** - exclude
  it from the zip-upload asset
  (`Source.asset(buildDir, {exclude: ['package']})`).
- **Agent zip must exist before ANY synth/deploy** (bin/infra.ts constructs all
  five stacks) - run `apps/ai/agents/build_agent.sh chat` first; deploy.sh's
  `ensure_agent_zip` does this, and `ChatAgent.ts` fails fast with that remedy
  if the zip is missing.
- **`ApiEndpoint` must have NO trailing slash** - the SPA joins
  `${VITE_API_URL}/random-number`, and `restApi.url` ends with `/` (double slash
  403s). Build the endpoint string manually, matching Terraform's `invoke_url`.
- **SPA Cache-Control needs two BucketDeployment passes** sharing ONE
  `Source.asset` (single build): hashed assets with
  `public, max-age=31536000, immutable` + `prune: true` (excluding index.html),
  then index.html with `no-cache` + `contentType: 'text/html'` + the CloudFront
  invalidation, with `indexPass.node.addDependency(assetsPass)`.
- **Seed docs deploy with `prune: true`** so deleting a file under `infra/seed/`
  removes it from the bucket (and the index on re-ingestion), matching
  Terraform's tracked `aws_s3_object` semantics.
- **Cognito `standardAttributes` can't express length constraints** - override
  `(userPool.node.defaultChild as cognito.CfnUserPool).schema` to set
  `stringAttributeConstraints` (Terraform pins given/family name to 1-256).
- **KB ingestion errors don't fail the deploy** - `AwsCustomResource` Lambda
  `invoke` can't inspect `FunctionError`, so a sync.py crash goes unnoticed
  (Terraform's `aws_lambda_invocation` would fail the apply). Check the
  `{prefix}-kb-sync` logs if retrieval looks stale.
- **AgentCore names**: runtime/memory/credential-provider = underscores only;
  gateway = hyphens only.
- **`gateway.gatewayUrl` is optional-typed** - default it (`?? ''`) before
  passing as env.
- **`cdk.FileSystem.fingerprint`** with `exclude: ['build', '__pycache__']` for
  agent source hashes - otherwise the built zip feeds back into its own trigger
  hash.
- **Region is pinned from `AppConfig.json`** via `config.region` into
  `env.region` (CDK_DEFAULT_REGION is only the fallback), matching the Terraform
  provider.
- **Never commit** `node_modules/`, `cdk.out/`, `cdk.context.json`, or compiled
  `*.js`/`*.d.ts` (see `infra/cdk/.gitignore`).

## Verify (read-only)

```bash
cd infra/cdk && npx tsc --noEmit && npx cdk synth --all --quiet
python3 -c "import json;print(sorted(json.load(open('cdk.out/dev-sample-agentic-app-AiStack.template.json'))['Resources'].keys())[:5])"
```

All five `dev-sample-agentic-app-*Stack` templates should appear under
`cdk.out/` with the KB (`S3_VECTORS`), S3 Vectors index, gateway + 2 targets,
OAuth2 provider, memory, and both runtimes present.
