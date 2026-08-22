import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { Construct } from 'constructs';

export interface OntologyConversationsFunctionsProps {
  resourcePrefix: string;
  awsUtilsLayer: lambda.ILayerVersion;
  // Ontology chat AgentCore Memory (from the Ai stack) — the session events these
  // read-only proxies list. id → MEMORY_ID env; arn → scoped IAM.
  memoryId: string;
  memoryArn: string;
}

// ontology domain, read side — AgentCore Memory proxies that let a user browse and
// replay their own past conversations about one ontology build. The browser holds
// only a Cognito JWT (no Identity Pool), so it can't SigV4-sign the AgentCore
// data-plane; these Cognito-authorized Lambdas front it:
//   GET /ontology/builds/{jobId}/conversations              -> listFunction (ListSessions)
//   GET /ontology/builds/{jobId}/conversations/{sessionId}  -> getFunction  (ListEvents)
//
// Nested under the build because the build IS the scope: the agent stores events
// under a composite "{sub}/{buildId}" actor, so listing one build's conversations
// is a single call rather than a filter.
export class OntologyConversationsFunctions extends Construct {
  public readonly listFunction: lambda.Function;
  public readonly getFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: OntologyConversationsFunctionsProps) {
    super(scope, id);

    const baseLambdaPath = path.join(__dirname, '../../../../../apps/apis/ontology/read');

    this.listFunction = new lambda.Function(this, 'ListFunction', {
      functionName: `${props.resourcePrefix}-ontology-conversations-list`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'list_ontology_conversations.lambda_handler',
      code: lambda.Code.fromAsset(baseLambdaPath, { exclude: ['__pycache__/**'] }),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      layers: [props.awsUtilsLayer],
      environment: {
        MEMORY_ID: props.memoryId,
      },
      logGroup: new logs.LogGroup(this, 'ListLogGroup', {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-ontology-conversations-list`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // No AgentCore grant method exists (mirrors ConversationsFunctions) — scope
    // ListSessions to the ontology chat memory only.
    this.listFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'ListSessions',
        actions: ['bedrock-agentcore:ListSessions'],
        resources: [props.memoryArn, `${props.memoryArn}/*`],
      })
    );

    this.getFunction = new lambda.Function(this, 'GetFunction', {
      functionName: `${props.resourcePrefix}-ontology-conversations-get`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get_ontology_conversation.lambda_handler',
      code: lambda.Code.fromAsset(baseLambdaPath, { exclude: ['__pycache__/**'] }),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      layers: [props.awsUtilsLayer],
      environment: {
        MEMORY_ID: props.memoryId,
      },
      logGroup: new logs.LogGroup(this, 'GetLogGroup', {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-ontology-conversations-get`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    this.getFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'ListEvents',
        actions: ['bedrock-agentcore:ListEvents'],
        resources: [props.memoryArn, `${props.memoryArn}/*`],
      })
    );
  }
}
