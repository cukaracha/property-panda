import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as path from 'path';
import { Construct } from 'constructs';

export interface ConverterProps {
  resourcePrefix: string;
  tempBucket: s3.IBucket;
  // Medallion lake layers — the ontology agent converts bronze documents
  // straight into silver instead of round-tripping through the temp bucket.
  bronzeBucket: s3.IBucket;
  silverBucket: s3.IBucket;
  apiKeysSecret: secretsmanager.ISecret;
  awsUtilsLayer: lambda.ILayerVersion;
}

// markdown_converter async job pipeline — an uploaded asset is converted to
// markdown off the request path:
//   POST /converter/convert -> triggerFunction -> writes a 'queued' job row +
//                                                  enqueues on the FIFO queue
//   (SQS FIFO) -> worker (container) -> runs the conversion, updates the row
//   GET  /converter/status  -> statusFunction  -> reads the job row (SPA polls)
// triggerFunction / statusFunction are wired behind the Cognito authorizer by
// the ApiGateway construct.
export class Converter extends Construct {
  public readonly triggerFunction: lambda.Function;
  public readonly statusFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: ConverterProps) {
    super(scope, id);

    const apiLambdaPath = path.join(__dirname, '../../../../../apps/apis/converter');
    const workerImagePath = path.join(__dirname, '../../../../../apps/ai/tools/markdown_converter');

    // Job status table — one row per conversion job (status queued|processing|
    // succeeded|failed, set by the handlers). TTL reaps finished rows.
    const jobTable = new dynamodb.Table(this, 'JobTable', {
      tableName: `${props.resourcePrefix}-converter-jobs`,
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // FIFO DLQ — messages that fail maxReceiveCount times land here.
    const dlq = new sqs.Queue(this, 'JobDlq', {
      queueName: `${props.resourcePrefix}-converter-dlq.fifo`,
      fifo: true,
      retentionPeriod: cdk.Duration.days(1),
    });

    // FIFO job queue. visibilityTimeout is 6x the worker's 15-min timeout per
    // SQS event-source guidance; content-based dedup (the trigger sends only a
    // MessageGroupId = jobId, no explicit dedup id).
    const jobQueue = new sqs.Queue(this, 'JobQueue', {
      queueName: `${props.resourcePrefix}-converter-queue.fifo`,
      fifo: true,
      contentBasedDeduplication: true,
      visibilityTimeout: cdk.Duration.minutes(90),
      retentionPeriod: cdk.Duration.days(1),
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: dlq,
      },
    });

    // Worker — container image (LibreOffice + ffmpeg base, x86_64). Pulls the
    // source from the temp bucket, writes markdown back, updates the job row.
    // No VPC (public network for third-party API calls + Transcribe).
    const worker = new lambda.DockerImageFunction(this, 'Worker', {
      functionName: `${props.resourcePrefix}-converter-worker`,
      code: lambda.DockerImageCode.fromImageAsset(workerImagePath, {
        platform: cdk.aws_ecr_assets.Platform.LINUX_AMD64,
      }),
      architecture: lambda.Architecture.X86_64,
      timeout: cdk.Duration.minutes(15),
      memorySize: 3008, // account Lambda memory ceiling
      environment: {
        JOB_TABLE: jobTable.tableName,
        SECRET_ARN: props.apiKeysSecret.secretArn,
      },
      logGroup: new logs.LogGroup(this, 'WorkerLogGroup', {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-converter-worker`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    props.tempBucket.grantReadWrite(worker);
    // Ontology-agent conversions read bronze and write silver.
    props.bronzeBucket.grantRead(worker);
    props.silverBucket.grantReadWrite(worker);
    props.apiKeysSecret.grantRead(worker);
    jobTable.grantReadWriteData(worker);

    // No CDK grant method exists for Transcribe — the audio/video converter
    // path (clients/transcribe_client.py) starts/polls transcription jobs.
    // These actions do not support resource-level scoping.
    worker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['transcribe:StartTranscriptionJob', 'transcribe:GetTranscriptionJob'],
        resources: ['*'],
      })
    );

    // Bedrock — the image converter path (clients/bedrock_utils.py) describes
    // images with Claude via the Converse API. Any-region foundation-model +
    // inference-profile scope covers the cross-region 'global.' inference profile.
    worker.addToRolePolicy(
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
    worker.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'BedrockMarketplaceSubscription',
        actions: ['aws-marketplace:Subscribe', 'aws-marketplace:ViewSubscriptions'],
        resources: ['*'],
      })
    );

    // SQS event source drives the worker (batchSize 1 — one job per invoke).
    // addEventSource also grants the worker consume permissions on the queue.
    worker.addEventSource(
      new lambdaEventSources.SqsEventSource(jobQueue, {
        batchSize: 1,
      })
    );

    // Trigger — mints a jobId, writes the 'queued' row, enqueues the job.
    this.triggerFunction = new lambda.Function(this, 'TriggerFunction', {
      functionName: `${props.resourcePrefix}-converter-trigger`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'trigger_conversion.lambda_handler',
      code: lambda.Code.fromAsset(apiLambdaPath, { exclude: ['__pycache__/**'] }),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      layers: [props.awsUtilsLayer],
      environment: {
        TEMP_BUCKET_NAME: props.tempBucket.bucketName,
        // The trigger only builds and validates S3 URIs against these names —
        // it never touches the buckets, so no IAM grant follows.
        BRONZE_BUCKET_NAME: props.bronzeBucket.bucketName,
        SILVER_BUCKET_NAME: props.silverBucket.bucketName,
        JOB_TABLE: jobTable.tableName,
        JOB_QUEUE_URL: jobQueue.queueUrl,
      },
      logGroup: new logs.LogGroup(this, 'TriggerLogGroup', {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-converter-trigger`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Trigger only builds S3 URIs (no bucket IAM) — it writes the job row and
    // sends the SQS message.
    jobTable.grantWriteData(this.triggerFunction);
    jobQueue.grantSendMessages(this.triggerFunction);

    // Status — reads the job row for the SPA's poller.
    this.statusFunction = new lambda.Function(this, 'StatusFunction', {
      functionName: `${props.resourcePrefix}-converter-status`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get_conversion_status.lambda_handler',
      code: lambda.Code.fromAsset(apiLambdaPath, { exclude: ['__pycache__/**'] }),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      layers: [props.awsUtilsLayer],
      environment: {
        JOB_TABLE: jobTable.tableName,
      },
      logGroup: new logs.LogGroup(this, 'StatusLogGroup', {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-converter-status`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    jobTable.grantReadData(this.statusFunction);
  }
}
