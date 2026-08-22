import * as cdk from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Construct } from 'constructs';

export interface ChatAgentProps {
  resourcePrefix: string;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  gatewayUrl: string;
  gatewayCredentialProviderName: string;
  gatewayScope: string;
}

// Chat agent deployed to Amazon Bedrock AgentCore Runtime via "direct code
// deployment": the agent source + ARM64 deps are zipped by
// apps/ai/agents/build_agent.sh chat (run by deploy.sh before this stack deploys),
// uploaded to a dedicated S3 bucket, and the runtime pulls that zip. Inbound
// auth is a Cognito JWT authorizer, so the browser invokes the runtime
// directly with a Cognito access token — no API Gateway / Lambda proxy.
export class ChatAgent extends Construct {
  public readonly chatAgentRuntimeArn: string;
  // Shared agent-artifacts bucket (holds the zip). Exposed so A2A subagents can
  // reuse the SAME bucket — one artifacts bucket per stack, matching Terraform's
  // shared aws_s3_bucket.agent_artifacts.
  public readonly artifactsBucket: s3.IBucket;
  // AgentCore Memory id/arn — exposed so the Api stack's read-only conversations
  // proxies can address (MEMORY_ID) and scope IAM to this same memory. Both are
  // immutable, so passing them as typed props (vs SSM) is safe.
  public readonly memoryId: string;
  public readonly memoryArn: string;

  constructor(scope: Construct, id: string, props: ChatAgentProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    // AgentCore Memory — cross-turn session state (short-term/raw events).
    // Memory names allow letters/digits/underscores only — no hyphens.
    const memory = new agentcore.Memory(this, 'Memory', {
      memoryName: `${props.resourcePrefix.replace(/-/g, '_')}_chat_memory`,
      description: 'Conversation memory for the chat agent',
      expirationDuration: cdk.Duration.days(30),
    });
    this.memoryId = memory.memoryId;
    this.memoryArn = memory.memoryArn;

    // Artifact bucket — holds the agent zip.
    const artifactsBucket = new s3.Bucket(this, 'ArtifactsBucket', {
      bucketName: `${props.resourcePrefix}-agentcore-${stack.account}-${stack.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    this.artifactsBucket = artifactsBucket;

    // The zip is built by apps/ai/agents/build_agent.sh (gitignored). bin/infra.ts
    // constructs every stack on any cdk command, so fail fast with the remedy
    // instead of a cryptic asset-staging error on a fresh checkout.
    const agentSrcPath = path.join(__dirname, '../../../../../../apps/ai/agents/chat');
    const agentZipPath = path.join(agentSrcPath, 'build/agent.zip');
    if (!fs.existsSync(agentZipPath)) {
      throw new Error(
        `Missing ${agentZipPath} — run "apps/ai/agents/build_agent.sh chat" first (deploy.sh does this automatically).`
      );
    }

    // Hash of the agent sources + build script (same inputs as Terraform).
    // Drives CODE_VERSION and the hash-named S3 prefix, so each code version
    // lands at a unique key — busting AgentCore's S3-zip cache.
    const codeHash = createHash('sha1')
      .update(cdk.FileSystem.fingerprint(agentSrcPath, { exclude: ['build', '__pycache__'] }))
      .update(cdk.FileSystem.fingerprint(path.join(agentSrcPath, '../build_agent.sh')))
      .digest('hex');

    // Upload the pre-built zip (apps/ai/agents/chat/build/agent.zip).
    const deployAgentCode = new s3deploy.BucketDeployment(this, 'DeployAgentCode', {
      // Only the zip itself — build/package/ is the unpacked staging area.
      sources: [s3deploy.Source.asset(path.join(agentSrcPath, 'build'), { exclude: ['package'] })],
      destinationBucket: artifactsBucket,
      destinationKeyPrefix: `chat_agent/${codeHash}`,
      // The handler's Python baseline uses ~97 MB of the default 128 MB; the
      // s3 sync of the ~47 MB zip then OOM-freezes it silently and
      // CloudFormation waits out its 1h custom-resource timeout. 1 GB also
      // buys proportional CPU for the multipart upload.
      memoryLimit: 1024,
    });

    // Runtime names allow letters/digits/underscores only — no hyphens.
    const agentRuntime = new agentcore.Runtime(this, 'Runtime', {
      runtimeName: `${props.resourcePrefix.replace(/-/g, '_')}_chat_agent`,
      agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromS3(
        {
          bucketName: artifactsBucket.bucketName,
          objectKey: `chat_agent/${codeHash}/agent.zip`,
        },
        agentcore.AgentCoreRuntime.PYTHON_3_12,
        // OTel auto-instrumentation: opentelemetry-instrument wraps main.py so the
        // agent emits traces/metrics to AgentCore observability. Requires the
        // aws-opentelemetry-distro dep (apps/ai/agents/chat/requirements.txt).
        ['opentelemetry-instrument', 'main.py']
      ),
      // Cognito JWT inbound authorizer — the browser sends a Cognito access
      // token as a Bearer token.
      authorizerConfiguration: agentcore.RuntimeAuthorizerConfiguration.usingCognito(
        props.userPool,
        [props.userPoolClient]
      ),
      networkConfiguration: agentcore.RuntimeNetworkConfiguration.usingPublicNetwork(),
      environmentVariables: {
        // CODE_VERSION busts AgentCore's S3-zip cache on a code change.
        CODE_VERSION: codeHash,
        MEMORY_ID: memory.memoryId,
        // MCP endpoint the agent connects to for tools.
        GATEWAY_URL: props.gatewayUrl,
        // AgentCore Identity (M2M) outbound auth to the gateway: the agent
        // mints its OWN gateway token — no user-token replay.
        GATEWAY_CREDENTIAL_PROVIDER: props.gatewayCredentialProviderName,
        GATEWAY_SCOPES: props.gatewayScope,
        // SSM path the orchestrator reads to auto-discover the A2A subagent
        // fleet. Deliberately not a CDK dependency — adding a subagent must
        // not redeploy chat.
        SUBAGENT_REGISTRY_PATH: `/${props.resourcePrefix}/a2a-subagents`,
      },
    });

    // Force the runtime to wait until the zip is uploaded to S3.
    agentRuntime.node.addDependency(deployAgentCode);

    // Read the agent zip from the artifact bucket.
    artifactsBucket.grantRead(agentRuntime);

    // Invoke any Bedrock foundation model / inference profile in this account.
    // Model selection lives in the agent code; IAM is intentionally not pinned
    // to a specific model. Any-region scope is required for `global.`
    // cross-region inference profiles.
    agentRuntime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'InvokeModel',
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/*',
          `arn:aws:bedrock:*:${stack.account}:inference-profile/*`,
        ],
      })
    );

    // Bedrock serves newer Anthropic models through AWS Marketplace; the first
    // invocation auto-subscribes the account. No resource scoping supported.
    agentRuntime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'BedrockMarketplaceSubscription',
        actions: ['aws-marketplace:Subscribe', 'aws-marketplace:ViewSubscriptions'],
        resources: ['*'],
      })
    );

    // Read the A2A subagent registry (SSM Parameter Store) to auto-discover
    // the fleet per request.
    agentRuntime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'ReadSubagentRegistry',
        actions: ['ssm:GetParametersByPath', 'ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${stack.region}:${stack.account}:parameter/${props.resourcePrefix}/a2a-subagents`,
          `arn:aws:ssm:${stack.region}:${stack.account}:parameter/${props.resourcePrefix}/a2a-subagents/*`,
        ],
      })
    );

    // Write runtime logs.
    agentRuntime.addToRolePolicy(
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

    // Workload identity token required by the AgentCore runtime contract.
    agentRuntime.addToRolePolicy(
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

    // Mint the agent's OWN gateway token via AgentCore Identity (M2M). The
    // action authorizes against a chain of dynamic/singleton AgentCore
    // Identity resources that don't scope cleanly, so ["*"], gated by the
    // runtime's injected WorkloadAccessToken.
    agentRuntime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'GatewayOauth2Token',
        actions: ['bedrock-agentcore:GetResourceOauth2Token'],
        resources: ['*'],
      })
    );

    // While serving GetResourceOauth2Token, AgentCore Identity reads the
    // vaulted Cognito M2M client secret from Secrets Manager under this
    // role's identity. Scoped to the provider's reserved secret name; the
    // trailing -* absorbs the random suffixes and survives rotation.
    agentRuntime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'ReadGatewayM2MSecret',
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${stack.region}:${stack.account}:secret:bedrock-agentcore-identity!default/oauth2/${props.gatewayCredentialProviderName}-*`,
        ],
      })
    );

    // Read/write conversation events on this stack's memory only.
    agentRuntime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'AgentCoreMemory',
        actions: [
          'bedrock-agentcore:GetMemory',
          'bedrock-agentcore:CreateEvent',
          'bedrock-agentcore:GetEvent',
          'bedrock-agentcore:ListEvents',
          'bedrock-agentcore:ListSessions',
          'bedrock-agentcore:ListActors',
          'bedrock-agentcore:RetrieveMemoryRecords',
        ],
        resources: [memory.memoryArn, `${memory.memoryArn}/*`],
      })
    );

    this.chatAgentRuntimeArn = agentRuntime.agentRuntimeArn;
  }
}
