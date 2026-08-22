import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';
import { ApiKeys } from './constructs/ai/shared/ApiKeys';
import { VectorStore } from './constructs/ai/tools/VectorStore';
import { KbTopicsTable } from './constructs/ai/tools/KbTopicsTable';
import { KnowledgeBase } from './constructs/ai/tools/KnowledgeBase';
import { KbTool } from './constructs/ai/tools/KbTool';
import { RandomNumberTool } from './constructs/ai/tools/RandomNumberTool';
import { WebSearchTool } from './constructs/ai/tools/WebSearchTool';
import { WebRetrieveTool } from './constructs/ai/tools/WebRetrieveTool';
import { OntologyVectorStore } from './constructs/ai/tools/OntologyVectorStore';
import { OntologyAgent } from './constructs/ai/agents/OntologyAgent';
import { OntologyChatAgent } from './constructs/ai/agents/OntologyChatAgent';
import { McpGateway } from './constructs/ai/agents/McpGateway';
import { ChatAgent } from './constructs/ai/agents/ChatAgent';
import { NumberSpecialist } from './constructs/ai/agents/NumberSpecialist';

interface AiStackProps extends cdk.StackProps {
  resourcePrefix: string;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  gatewayM2mClient: cognito.IUserPoolClient;
  gatewayScope: string;
  kbDataBucket: s3.IBucket;
  tempBucket: s3.IBucket;
  bronzeBucket: s3.IBucket;
  silverBucket: s3.IBucket;
  goldBucket: s3.IBucket;
  claudeTokensSecret: secretsmanager.ISecret;
}

export class AiStack extends cdk.Stack {
  public readonly randomNumberFunction: lambda.Function;
  public readonly kbToolFunction: lambda.Function;
  public readonly webSearchFunction: lambda.Function;
  public readonly webRetrieveFunction: lambda.DockerImageFunction;
  public readonly ontologyStartFunction: lambda.Function;
  public readonly ontologyStatusFunction: lambda.Function;
  public readonly ontologyListFunction: lambda.Function;
  public readonly ontologyOutputsFunction: lambda.Function;
  // What the Api stack's purge worker needs to tear a build down: the row, the
  // execution named after it, and the index its pages were written to.
  public readonly ontologyJobTable: dynamodb.ITable;
  public readonly ontologyConvertStateMachineArn: string;
  // The machine itself, for the corpus-update Lambda, which starts an execution on
  // it rather than only naming it.
  public readonly ontologyConvertStateMachine: stepfunctions.IStateMachine;
  public readonly ontologyVectorBucketArn: string;
  public readonly ontologyVectorBucketName: string;
  public readonly ontologyVectorIndexArn: string;
  public readonly ontologyVectorIndexName: string;
  public readonly ontologyChatRuntimeArn: string;
  public readonly ontologyChatMemoryId: string;
  public readonly ontologyChatMemoryArn: string;
  public readonly chatAgentRuntimeArn: string;
  public readonly chatMemoryId: string;
  public readonly chatMemoryArn: string;
  public readonly apiKeysSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: AiStackProps) {
    super(scope, id, props);

    // Third-party API-key secret the (Phase 4) converter worker will read. Lives
    // in the Ai stack so the future worker can grant.grantRead(worker) on it.
    const apiKeys = new ApiKeys(this, 'ApiKeys', {
      resourcePrefix: props.resourcePrefix,
    });
    this.apiKeysSecret = apiKeys.secret;

    // aws_utils layer shared from CoreStack via SSM rather than a typed prop:
    // a CloudFormation export cannot change while imported, which would block
    // re-publishing the layer. Ordering comes from ai.addDependency(core).
    const awsUtilsLayerArn = ssm.StringParameter.valueForStringParameter(
      this,
      `/${props.resourcePrefix}/layers/aws-utils-arn`
    );
    const awsUtilsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      'AwsUtilsLayer',
      awsUtilsLayerArn
    );

    // Vector store + topicId -> dataSourceId mapping
    const vectorStore = new VectorStore(this, 'VectorStore', {
      resourcePrefix: props.resourcePrefix,
    });

    const kbTopicsTable = new KbTopicsTable(this, 'KbTopicsTable', {
      resourcePrefix: props.resourcePrefix,
    });

    // Bedrock knowledge base (S3 Vectors store) + seed docs + data sources
    const knowledgeBase = new KnowledgeBase(this, 'KnowledgeBase', {
      resourcePrefix: props.resourcePrefix,
      kbDataBucket: props.kbDataBucket,
      vectorBucketArn: vectorStore.vectorBucketArn,
      vectorIndexArn: vectorStore.indexArn,
      kbTopicsTable: kbTopicsTable.table,
    });

    // Tool Lambdas
    const kbTool = new KbTool(this, 'KbTool', {
      resourcePrefix: props.resourcePrefix,
      knowledgeBaseId: knowledgeBase.knowledgeBaseId,
      knowledgeBaseArn: knowledgeBase.knowledgeBaseArn,
      kbTopicsTable: kbTopicsTable.table,
      awsUtilsLayer,
    });

    const randomNumberTool = new RandomNumberTool(this, 'RandomNumberTool', {
      resourcePrefix: props.resourcePrefix,
      awsUtilsLayer,
    });

    // web_search tool — Brave Search (keyed via the api-keys secret) + optional
    // Bedrock relevance judge. web_retrieve tool — keyless headless-browser
    // fetcher (Crawl4AI container image). Both dual-entrypoint (MCP + REST).
    const webSearchTool = new WebSearchTool(this, 'WebSearchTool', {
      resourcePrefix: props.resourcePrefix,
      awsUtilsLayer,
      apiKeysSecret: apiKeys.secret,
    });

    const webRetrieveTool = new WebRetrieveTool(this, 'WebRetrieveTool', {
      resourcePrefix: props.resourcePrefix,
    });

    // The page index every built ontology is searched through. Declared before the
    // build agent because the hydrate Lambda writes into it and the chat agent reads
    // from it, and both take it as typed props.
    const ontologyVectors = new OntologyVectorStore(this, 'OntologyVectorStore', {
      resourcePrefix: props.resourcePrefix,
    });

    // ontology build — one Claude Agent SDK agent on an AgentCore container
    // runtime (orchestrator + four stage subagents), replacing the retired Step
    // Functions pipeline. It runs on the caller's own Claude subscription and
    // reads/writes the medallion lake; its control Lambdas are exposed for the
    // Api stack (REST).
    const ontology = new OntologyAgent(this, 'OntologyAgent', {
      resourcePrefix: props.resourcePrefix,
      bronzeBucket: props.bronzeBucket,
      silverBucket: props.silverBucket,
      goldBucket: props.goldBucket,
      claudeTokensSecret: props.claudeTokensSecret,
      awsUtilsLayer,
      vectorBucketArn: ontologyVectors.vectorBucketArn,
      vectorBucketName: ontologyVectors.vectorBucketName,
      vectorIndexArn: ontologyVectors.indexArn,
      vectorIndexName: ontologyVectors.indexName,
    });

    // ontology retrieval — a second container runtime that answers questions about a
    // finished build by walking its graph. Browser-invocable (Cognito JWT), so it
    // needs no API Gateway route; its tools are in-process, so it needs no gateway
    // target.
    const ontologyChat = new OntologyChatAgent(this, 'OntologyChatAgent', {
      resourcePrefix: props.resourcePrefix,
      userPool: props.userPool,
      userPoolClient: props.userPoolClient,
      goldBucket: props.goldBucket,
      jobTable: ontology.jobTable,
      claudeTokensSecret: props.claudeTokensSecret,
      vectorBucketArn: ontologyVectors.vectorBucketArn,
      vectorBucketName: ontologyVectors.vectorBucketName,
      vectorIndexArn: ontologyVectors.indexArn,
      vectorIndexName: ontologyVectors.indexName,
    });

    // MCP gateway exposing the tool Lambdas + the M2M credential provider
    const mcpGateway = new McpGateway(this, 'McpGateway', {
      resourcePrefix: props.resourcePrefix,
      userPool: props.userPool,
      userPoolClient: props.userPoolClient,
      gatewayM2mClient: props.gatewayM2mClient,
      randomNumberFunction: randomNumberTool.function,
      kbToolFunction: kbTool.function,
      webSearchFunction: webSearchTool.function,
      webRetrieveFunction: webRetrieveTool.function,
    });

    // Chat agent (zip-based AgentCore runtime + memory)
    const chatAgent = new ChatAgent(this, 'ChatAgent', {
      resourcePrefix: props.resourcePrefix,
      userPool: props.userPool,
      userPoolClient: props.userPoolClient,
      gatewayUrl: mcpGateway.gatewayUrl,
      gatewayCredentialProviderName: mcpGateway.credentialProviderName,
      gatewayScope: props.gatewayScope,
    });

    // A2A subagent fleet — member #1: number_specialist (zip "direct code
    // deployment" runtime; reuses the chat agent's shared artifacts bucket).
    const numberSpecialist = new NumberSpecialist(this, 'NumberSpecialist', {
      resourcePrefix: props.resourcePrefix,
      userPool: props.userPool,
      userPoolClient: props.userPoolClient,
      gatewayUrl: mcpGateway.gatewayUrl,
      gatewayCredentialProviderName: mcpGateway.credentialProviderName,
      gatewayScope: props.gatewayScope,
      artifactsBucket: chatAgent.artifactsBucket,
    });

    // Expose values for dependent stacks
    this.randomNumberFunction = randomNumberTool.function;
    this.kbToolFunction = kbTool.function;
    this.webSearchFunction = webSearchTool.function;
    this.webRetrieveFunction = webRetrieveTool.function;
    this.ontologyStartFunction = ontology.startFunction;
    this.ontologyStatusFunction = ontology.statusFunction;
    this.ontologyListFunction = ontology.listFunction;
    this.ontologyOutputsFunction = ontology.outputsFunction;
    this.ontologyJobTable = ontology.jobTable;
    this.ontologyConvertStateMachineArn = ontology.convertStateMachine.stateMachineArn;
    this.ontologyConvertStateMachine = ontology.convertStateMachine;
    this.ontologyVectorBucketArn = ontologyVectors.vectorBucketArn;
    this.ontologyVectorBucketName = ontologyVectors.vectorBucketName;
    this.ontologyVectorIndexArn = ontologyVectors.indexArn;
    this.ontologyVectorIndexName = ontologyVectors.indexName;
    this.ontologyChatRuntimeArn = ontologyChat.runtimeArn;
    this.ontologyChatMemoryId = ontologyChat.memoryId;
    this.ontologyChatMemoryArn = ontologyChat.memoryArn;
    this.chatAgentRuntimeArn = chatAgent.chatAgentRuntimeArn;
    this.chatMemoryId = chatAgent.memoryId;
    this.chatMemoryArn = chatAgent.memoryArn;

    new cdk.CfnOutput(this, 'ChatAgentRuntimeArn', {
      value: chatAgent.chatAgentRuntimeArn,
      description: 'ARN of the AgentCore chat runtime (used by the SPA to invoke chat)',
    });

    new cdk.CfnOutput(this, 'OntologyChatRuntimeArn', {
      value: ontologyChat.runtimeArn,
      description:
        'ARN of the AgentCore ontology retrieval runtime (used by the SPA to ask an ontology)',
    });

    new cdk.CfnOutput(this, 'GatewayUrl', {
      value: mcpGateway.gatewayUrl,
      description: 'MCP endpoint of the AgentCore Gateway',
    });

    new cdk.CfnOutput(this, 'KnowledgeBaseId', {
      value: knowledgeBase.knowledgeBaseId,
      description: 'Id of the Bedrock knowledge base backing the course_knowledge_base tool',
    });

    new cdk.CfnOutput(this, 'NumberSpecialistRuntimeArn', {
      value: numberSpecialist.runtimeArn,
      description: 'ARN of the number_specialist A2A subagent runtime',
    });

    new cdk.CfnOutput(this, 'ApiKeysSecretName', {
      value: this.apiKeysSecret.secretName,
      description: 'Name of the third-party API keys secret (set real values after deploy)',
    });
  }
}
