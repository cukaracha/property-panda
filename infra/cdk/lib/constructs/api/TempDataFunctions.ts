import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as path from 'path';
import { Construct } from 'constructs';

export interface TempDataFunctionsProps {
  resourcePrefix: string;
  tempBucket: s3.IBucket;
  awsUtilsLayer: lambda.ILayerVersion;
}

// temp_data domain — presigned-URL functions fronting the temp bucket:
//   POST /temp-data/upload-url   -> uploadUrlFunction   (read/write)
//   GET  /temp-data/download-url -> downloadUrlFunction  (read)
// Both are wired behind the Cognito authorizer by the ApiGateway construct.
export class TempDataFunctions extends Construct {
  public readonly uploadUrlFunction: lambda.Function;
  public readonly downloadUrlFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: TempDataFunctionsProps) {
    super(scope, id);

    const baseLambdaPath = path.join(__dirname, '../../../../../apps/apis/temp_data');

    this.uploadUrlFunction = new lambda.Function(this, 'UploadUrlFunction', {
      functionName: `${props.resourcePrefix}-temp-data-upload-url`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get_upload_url.lambda_handler',
      code: lambda.Code.fromAsset(path.join(baseLambdaPath, 'create')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      layers: [props.awsUtilsLayer],
      environment: {
        TEMP_BUCKET_NAME: props.tempBucket.bucketName,
      },
      logGroup: new logs.LogGroup(this, 'UploadUrlLogGroup', {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-temp-data-upload-url`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    this.downloadUrlFunction = new lambda.Function(this, 'DownloadUrlFunction', {
      functionName: `${props.resourcePrefix}-temp-data-download-url`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get_download_url.lambda_handler',
      code: lambda.Code.fromAsset(path.join(baseLambdaPath, 'read')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      layers: [props.awsUtilsLayer],
      environment: {
        TEMP_BUCKET_NAME: props.tempBucket.bucketName,
      },
      logGroup: new logs.LogGroup(this, 'DownloadUrlLogGroup', {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-temp-data-download-url`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Presigned PUT needs read/write; presigned GET needs read only.
    props.tempBucket.grantReadWrite(this.uploadUrlFunction);
    props.tempBucket.grantRead(this.downloadUrlFunction);
  }
}
