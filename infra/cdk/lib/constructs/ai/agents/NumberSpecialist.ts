import * as cdk from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Construct } from 'constructs';

export interface NumberSpecialistProps {
  resourcePrefix: string;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  gatewayUrl: string;
  gatewayCredentialProviderName: string;
  gatewayScope: string;
  // Shared agent-artifacts bucket (from ChatAgent) — the zip is uploaded here
  // under a number_specialist/ prefix, mirroring Terraform's single shared bucket.
  artifactsBucket: s3.IBucket;
}

// A2A subagent fleet — member #1: number_specialist. Like the chat agent, this
// ships as a zip "direct code deployment": apps/ai/agents/build_agent.sh
// number_specialist (run by deploy.sh before this stack deploys) zips the ARM64
// deps + sources, they are uploaded to the shared artifacts bucket, and the
// runtime pulls that zip via code_configuration — while keeping
// protocolConfiguration: A2A. AgentCore runs main.py, which starts serve_a2a on
// 0.0.0.0:9000; DOCKER_CONTAINER=1 forces that bind without a real container.
//
// The orchestrator auto-discovers it from the SSM registry at request time, so
// adding subagent #2 means copying this construct (new name) — no chat-agent
// change. Auth splits by direction: INBOUND (chat -> subagent A2A call) is
// validated by this runtime's Cognito JWT authorizer using the user's token;
// OUTBOUND (subagent -> gateway MCP call) uses the subagent's OWN AgentCore
// Identity M2M token — no user-token replay.
export class NumberSpecialist extends Construct {
  public readonly runtimeArn: string;

  constructor(scope: Construct, id: string, props: NumberSpecialistProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    // The zip is built by apps/ai/agents/build_agent.sh (gitignored). bin/infra.ts
    // constructs every stack on any cdk command, so fail fast with the remedy
    // instead of a cryptic asset-staging error on a fresh checkout.
    const agentSrcPath = path.join(__dirname, '../../../../../../apps/ai/agents/number_specialist');
    const agentZipPath = path.join(agentSrcPath, 'build/agent.zip');
    if (!fs.existsSync(agentZipPath)) {
      throw new Error(
        `Missing ${agentZipPath} — run "apps/ai/agents/build_agent.sh number_specialist" first (deploy.sh does this automatically).`
      );
    }

    // Hash of the agent sources + build script (same inputs as Terraform's
    // subagent_source_hash). Drives CODE_VERSION and the hash-named S3 prefix, so
    // each code version lands at a unique key — busting AgentCore's S3-zip cache.
    const codeHash = createHash('sha1')
      .update(cdk.FileSystem.fingerprint(agentSrcPath, { exclude: ['build', '__pycache__'] }))
      .update(cdk.FileSystem.fingerprint(path.join(agentSrcPath, '../build_agent.sh')))
      .digest('hex');

    // Upload the pre-built zip (apps/ai/agents/number_specialist/build/agent.zip)
    // to the shared artifacts bucket under a number_specialist/ prefix.
    const deployAgentCode = new s3deploy.BucketDeployment(this, 'DeployAgentCode', {
      // Only the zip itself — build/package/ is the unpacked staging area.
      sources: [s3deploy.Source.asset(path.join(agentSrcPath, 'build'), { exclude: ['package'] })],
      destinationBucket: props.artifactsBucket,
      destinationKeyPrefix: `number_specialist/${codeHash}`,
      // Same headroom as the chat agent: the s3 sync of the vendored-deps zip
      // OOM-freezes the default 128 MB handler otherwise.
      memoryLimit: 1024,
    });

    // Runtime names allow letters/digits/underscores only — no hyphens.
    const runtime = new agentcore.Runtime(this, 'Runtime', {
      runtimeName: `${props.resourcePrefix.replace(/-/g, '_')}_number_specialist`,
      // Direct code deployment: pull the pre-built zip from the shared artifacts
      // bucket. entry_point main.py must match the zip-root file.
      agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromS3(
        {
          bucketName: props.artifactsBucket.bucketName,
          objectKey: `number_specialist/${codeHash}/agent.zip`,
        },
        agentcore.AgentCoreRuntime.PYTHON_3_12,
        ['main.py']
      ),
      // A2A server protocol — exposes /.well-known/agent-card.json + JSON-RPC.
      protocolConfiguration: agentcore.ProtocolType.A2A,
      // Inbound A2A auth: the chat orchestrator calls this runtime with the
      // user's Cognito token, validated against the same pool/client as chat.
      authorizerConfiguration: agentcore.RuntimeAuthorizerConfiguration.usingCognito(
        props.userPool,
        [props.userPoolClient]
      ),
      networkConfiguration: agentcore.RuntimeNetworkConfiguration.usingPublicNetwork(),
      // Do NOT set AGENTCORE_RUNTIME_URL — AgentCore injects it at runtime and
      // serve_a2a uses it to advertise the real invocation URL in the agent card.
      environmentVariables: {
        // CODE_VERSION busts AgentCore's S3-zip cache on a code change.
        CODE_VERSION: codeHash,
        // Force serve_a2a to bind 0.0.0.0 in this container-less deployment (it
        // otherwise only binds 0.0.0.0 when it detects a container).
        DOCKER_CONTAINER: '1',
        GATEWAY_URL: props.gatewayUrl,
        // Same credential provider + scopes as the chat agent: the subagent
        // mints its OWN gateway token keyed off the injected WorkloadAccessToken.
        GATEWAY_CREDENTIAL_PROVIDER: props.gatewayCredentialProviderName,
        GATEWAY_SCOPES: props.gatewayScope,
      },
    });

    // Force the runtime to wait until the zip is uploaded to S3.
    runtime.node.addDependency(deployAgentCode);

    // Read the agent zip from the shared artifact bucket.
    props.artifactsBucket.grantRead(runtime);

    // Policy mirrors the chat role MINUS AgentCore Memory and the subagent
    // registry read (it's stateless and discovers no one); bucket read rights
    // come from grantRead above.
    runtime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'InvokeModel',
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/*',
          `arn:aws:bedrock:*:${stack.account}:inference-profile/*`,
        ],
      })
    );

    runtime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'BedrockMarketplaceSubscription',
        actions: ['aws-marketplace:Subscribe', 'aws-marketplace:ViewSubscriptions'],
        resources: ['*'],
      })
    );

    runtime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'Logs',
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          'logs:DescribeLogStreams',
          'logs:DescribeLogGroups',
        ],
        resources: [
          `arn:aws:logs:${stack.region}:${stack.account}:log-group:/aws/bedrock-agentcore/*`,
        ],
      })
    );

    runtime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'WorkloadIdentity',
        actions: [
          'bedrock-agentcore:GetWorkloadAccessToken',
          'bedrock-agentcore:GetWorkloadAccessTokenForJWT',
          'bedrock-agentcore:GetWorkloadAccessTokenForUserId',
        ],
        resources: ['*'],
      })
    );

    runtime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'GatewayOauth2Token',
        actions: ['bedrock-agentcore:GetResourceOauth2Token'],
        resources: ['*'],
      })
    );

    runtime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'ReadGatewayM2MSecret',
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${stack.region}:${stack.account}:secret:bedrock-agentcore-identity!default/oauth2/${props.gatewayCredentialProviderName}-*`,
        ],
      })
    );

    // Registry entry — the single registration point the orchestrator
    // discovers. Adding a subagent = a new runtime + one parameter like this.
    new ssm.StringParameter(this, 'RegistryEntry', {
      parameterName: `/${props.resourcePrefix}/a2a-subagents/number_specialist`,
      stringValue: runtime.agentRuntimeArn,
    });

    this.runtimeArn = runtime.agentRuntimeArn;
  }
}
