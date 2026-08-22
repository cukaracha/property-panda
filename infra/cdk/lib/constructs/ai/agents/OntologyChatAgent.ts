import * as cdk from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as path from 'path';
import { Construct } from 'constructs';

export interface OntologyChatAgentProps {
  resourcePrefix: string;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  goldBucket: s3.IBucket;
  jobTable: dynamodb.ITable;
  claudeTokensSecret: secretsmanager.ISecret;
  vectorBucketArn: string;
  vectorBucketName: string;
  vectorIndexArn: string;
  vectorIndexName: string;
}

// Asking questions of a finished ontology — a Claude Agent SDK agent on an AgentCore
// container runtime, separate from the build agent that produced it.
//
// It walks pages rather than searching them. A plain vector search cannot answer a
// question whose answer is split across documents that never mention each other; the
// graph can, because both documents touch a node they share. The five tools it holds
// are primitives (search, read a page, list a page's relations, take one hop, describe
// the corpus) and the n-hop walk is assembled from them by subagents the orchestrator
// dispatches — which is what makes the depth a decision rather than a constant, and
// keeps the pages a search reads out of the orchestrator's context.
//
// No gateway target, no tool Lambda, nothing in either IaC tree for the tools: they
// are in-process MCP servers inside the runtime, so the whole flow runs on the
// caller's own Claude subscription.
//
// Unlike the build runtime, this one carries a Cognito JWT authorizer, because the
// browser invokes it directly with an access token and reads the answer back over
// SSE. The verified `sub` off that token is what every read path is derived from —
// which is why the request header allowlist below is part of the auth story rather
// than a tuning knob: the authorizer consumes the header, and only the allowlist
// puts it back in front of the agent.
export class OntologyChatAgent extends Construct {
  public readonly runtimeArn: string;
  // AgentCore Memory id/arn — exposed so the Api stack's read-only conversation
  // proxies can address (MEMORY_ID) and scope IAM to this same memory.
  public readonly memoryId: string;
  public readonly memoryArn: string;

  constructor(scope: Construct, id: string, props: OntologyChatAgentProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);
    const agentPath = path.join(__dirname, '../../../../../../apps/ai/agents/ontology_chat');

    // AgentCore Memory — short-term raw events, no strategies, so a turn comes
    // back exactly as it was written.
    //
    // Its own memory rather than the chat agent's: that one holds serialized
    // Strands envelopes its replay endpoint has to reverse-engineer, and these
    // events are plain text. One reader per store, and neither has to guess.
    //
    // Memory names allow letters/digits/underscores only — no hyphens — and are
    // length-capped, hence the abbreviated `_onto_chat_memory`.
    const memory = new agentcore.Memory(this, 'Memory', {
      memoryName: `${props.resourcePrefix.replace(/-/g, '_')}_onto_chat_memory`,
      description: 'Conversation memory for the ontology chat agent',
      expirationDuration: cdk.Duration.days(30),
    });
    this.memoryId = memory.memoryId;
    this.memoryArn = memory.memoryArn;

    // ARM64 because AgentCore runs containers on aarch64.
    const runtime = new agentcore.Runtime(this, 'Runtime', {
      // Runtime names allow letters/digits/underscores only — no hyphens.
      runtimeName: `${props.resourcePrefix.replace(/-/g, '_')}_ontology_chat_agent`,
      description: 'Claude Agent SDK ontology retrieval (orchestrator + seeker + explorer)',
      agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromAsset(agentPath, {
        platform: cdk.aws_ecr_assets.Platform.LINUX_ARM64,
      }),
      // Cognito JWT inbound authorizer — the browser sends a Cognito access token as
      // a Bearer token, and the agent reads the caller's sub off that verified token.
      authorizerConfiguration: agentcore.RuntimeAuthorizerConfiguration.usingCognito(
        props.userPool,
        [props.userPoolClient]
      ),
      // Load-bearing, not decoration. The authorizer consumes Authorization at the
      // front door and AgentCore forwards it into the container only when the runtime
      // allowlists it; without this the agent sees no token and refuses every question.
      requestHeaderConfiguration: {
        allowlistedHeaders: ['Authorization'],
      },
      networkConfiguration: agentcore.RuntimeNetworkConfiguration.usingPublicNetwork(),
      environmentVariables: {
        JOB_TABLE: props.jobTable.tableName,
        CLAUDE_TOKENS_SECRET: props.claudeTokensSecret.secretArn,
        GOLD_BUCKET_NAME: props.goldBucket.bucketName,
        VECTOR_BUCKET: props.vectorBucketName,
        VECTOR_INDEX: props.vectorIndexName,
        MEMORY_ID: memory.memoryId,
      },
    });

    // The caller's own Claude token — the only credential the agent's model calls use.
    props.claudeTokensSecret.grantRead(runtime);

    // Read-only over the lake. A question can never write to a build, so gold is
    // granted read and nothing else; tenancy inside the bucket is enforced in the
    // handlers from the verified sub.
    props.goldBucket.grantRead(runtime);

    // Ownership check before any prefix is derived from a build id.
    props.jobTable.grantReadData(runtime);

    // Query the page index. PutVectors belongs to the hydrate Lambda, not here.
    // GetVectors is what authorizes the metadata coming back: QueryVectors alone
    // permits the query but not `returnMetadata`, and every hit is keyed off the
    // pageId held there, so without it the search returns AccessDenied.
    runtime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'QueryPageVectors',
        actions: ['s3vectors:QueryVectors', 's3vectors:GetVectors', 's3vectors:GetIndex'],
        resources: [props.vectorBucketArn, props.vectorIndexArn],
      })
    );

    // Embeddings only. Text generation runs on the caller's Claude subscription, so
    // this role holds no general Bedrock model access; the query still has to be
    // embedded with the same model the index was written with.
    runtime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'InvokeTitanEmbeddings',
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${stack.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        ],
      })
    );

    // Write a turn, read the conversation back. Two actions, not the chat agent's
    // seven: this runtime never lists sessions (the picker's Lambda does) and has
    // no strategies to retrieve records from.
    runtime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'AgentCoreMemory',
        actions: ['bedrock-agentcore:CreateEvent', 'bedrock-agentcore:ListEvents'],
        resources: [memory.memoryArn, `${memory.memoryArn}/*`],
      })
    );

    this.runtimeArn = runtime.agentRuntimeArn;
  }
}
