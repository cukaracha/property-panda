import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { Construct } from 'constructs';

export interface RandomNumberToolProps {
  resourcePrefix: string;
  awsUtilsLayer: lambda.ILayerVersion;
}

// random_number tool — generates a random integer (takes no input).
// Dual-entrypoint: invoked by the AgentCore gateway as an MCP tool target AND
// directly by API Gateway as a Cognito-authorized REST endpoint (ApiStack).
export class RandomNumberTool extends Construct {
  public readonly function: lambda.Function;

  constructor(scope: Construct, id: string, props: RandomNumberToolProps) {
    super(scope, id);

    this.function = new lambda.Function(this, 'Function', {
      functionName: `${props.resourcePrefix}-random-number-tool`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'random_number.lambda_handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../../../../../apps/ai/tools/random_number')
      ),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      layers: [props.awsUtilsLayer],
      logGroup: new logs.LogGroup(this, 'LogGroup', {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-random-number-tool`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });
  }
}
