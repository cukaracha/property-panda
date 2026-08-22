import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { Construct } from 'constructs';

export interface WebRetrieveToolProps {
  resourcePrefix: string;
}

// web_retrieve tool — fetch one URL and return clean markdown, rendered with a
// real headless browser (Crawl4AI + Playwright/Chromium). Container-image Lambda
// (x86_64) built from the upstream unclecode/crawl4ai base plus the Lambda
// Runtime Interface Client (see apps/ai/tools/web_retrieve/Dockerfile). Keyless /
// self-hosted (no secret, no Bedrock); IAM = Logs only (default execution role).
// Dual-entrypoint: invoked by the AgentCore gateway as an MCP tool target AND
// directly by API Gateway as a Cognito-authorized REST endpoint (ApiStack).
export class WebRetrieveTool extends Construct {
  public readonly function: lambda.DockerImageFunction;

  constructor(scope: Construct, id: string, props: WebRetrieveToolProps) {
    super(scope, id);

    this.function = new lambda.DockerImageFunction(this, 'Function', {
      functionName: `${props.resourcePrefix}-web-retrieve-tool`,
      code: lambda.DockerImageCode.fromImageAsset(
        path.join(__dirname, '../../../../../../apps/ai/tools/web_retrieve'),
        {
          platform: cdk.aws_ecr_assets.Platform.LINUX_AMD64,
          cmd: ['web_retrieve.lambda_handler'],
        }
      ),
      architecture: lambda.Architecture.X86_64,
      timeout: cdk.Duration.seconds(180),
      memorySize: 3008, // account Lambda memory ceiling
      ephemeralStorageSize: cdk.Size.mebibytes(2048), // Chromium user-data-dir + browser cache under /tmp
      logGroup: new logs.LogGroup(this, 'LogGroup', {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-web-retrieve-tool`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });
  }
}
