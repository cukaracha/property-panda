import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'path';
import { Construct } from 'constructs';

export interface LambdaLayersProps {
  resourcePrefix: string;
}

export class LambdaLayers extends Construct {
  public readonly awsUtilsLayer: lambda.LayerVersion;

  constructor(scope: Construct, id: string, props: LambdaLayersProps) {
    super(scope, id);

    this.awsUtilsLayer = new lambda.LayerVersion(this, 'AwsUtilsLayer', {
      layerVersionName: `${props.resourcePrefix}-aws-utils-layer`,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../../../../apps/shared/lambda_layers/aws_utils')
      ),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: 'Shared AWS utilities (CORS/response helpers + auth-context parser)',
    });

    // Cross-stack contract: consumer stacks read the layer ARN from SSM instead
    // of a CloudFormation export, so re-publishing the layer is never blocked
    // by an export-in-use lock. Ordering comes from stack-level addDependency.
    new ssm.StringParameter(this, 'AwsUtilsLayerArnParam', {
      parameterName: `/${props.resourcePrefix}/layers/aws-utils-arn`,
      stringValue: this.awsUtilsLayer.layerVersionArn,
    });
  }
}
