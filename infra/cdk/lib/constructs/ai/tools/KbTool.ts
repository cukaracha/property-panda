import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { Construct } from 'constructs';

export interface KbToolProps {
  resourcePrefix: string;
  knowledgeBaseId: string;
  knowledgeBaseArn: string;
  kbTopicsTable: dynamodb.ITable;
  awsUtilsLayer: lambda.ILayerVersion;
}

// course_knowledge_base tool — maps a topicId to its Bedrock data source id
// (kb_topics table) and runs a Retrieve filtered to that data source. MCP-only
// (registered as a gateway target in McpGateway.ts); no REST route.
export class KbTool extends Construct {
  public readonly function: lambda.Function;

  constructor(scope: Construct, id: string, props: KbToolProps) {
    super(scope, id);

    this.function = new lambda.Function(this, 'Function', {
      functionName: `${props.resourcePrefix}-kb-tool`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'kb.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../../../../apps/ai/tools/kb')),
      // A single Bedrock Retrieve against the S3 Vectors store.
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      layers: [props.awsUtilsLayer],
      environment: {
        KB_ID: props.knowledgeBaseId,
        KB_TOPIC_TABLE: props.kbTopicsTable.tableName,
      },
      logGroup: new logs.LogGroup(this, 'LogGroup', {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-kb-tool`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    props.kbTopicsTable.grantReadData(this.function);

    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'Retrieve',
        actions: ['bedrock:Retrieve'],
        resources: [props.knowledgeBaseArn],
      })
    );
  }
}
