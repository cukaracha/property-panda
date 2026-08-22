import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as path from 'path';
import { Construct } from 'constructs';

export interface WebSearchToolProps {
  resourcePrefix: string;
  awsUtilsLayer: lambda.ILayerVersion;
  apiKeysSecret: secretsmanager.ISecret;
}

// web_search tool — Brave Search API candidate results (title/url/snippet,
// metadata only). Reads BRAVE_API_KEY from the shared api-keys secret
// (SECRET_ARN); the optional llm_eval relevance judge calls Bedrock.
// Dual-entrypoint: invoked by the AgentCore gateway as an MCP tool target AND
// directly by API Gateway as a Cognito-authorized REST endpoint (ApiStack).
export class WebSearchTool extends Construct {
  public readonly function: lambda.Function;

  constructor(scope: Construct, id: string, props: WebSearchToolProps) {
    super(scope, id);

    this.function = new lambda.Function(this, 'Function', {
      functionName: `${props.resourcePrefix}-web-search-tool`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'web_search.lambda_handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../../../../../apps/ai/tools/web_search')
      ),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      layers: [props.awsUtilsLayer],
      environment: {
        SECRET_ARN: props.apiKeysSecret.secretArn,
      },
      logGroup: new logs.LogGroup(this, 'LogGroup', {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-web-search-tool`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // BRAVE_API_KEY lives in the shared api-keys secret.
    props.apiKeysSecret.grantRead(this.function);

    // Bedrock — the optional llm_eval relevance judge (bedrock_utils.converse_text).
    // Any-region foundation-model + inference-profile scope covers the cross-region
    // 'global.' inference profile.
    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'InvokeModel',
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/*',
          `arn:aws:bedrock:*:${cdk.Stack.of(this).account}:inference-profile/*`,
        ],
      })
    );

    // Required for first-use of Anthropic models via the Bedrock marketplace.
    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'BedrockMarketplaceSubscription',
        actions: ['aws-marketplace:Subscribe', 'aws-marketplace:ViewSubscriptions'],
        resources: ['*'],
      })
    );
  }
}
