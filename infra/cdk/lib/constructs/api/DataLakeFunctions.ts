import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as path from 'path';
import { Construct } from 'constructs';

export interface DataLakeFunctionsProps {
  resourcePrefix: string;
  bronzeBucket: s3.IBucket;
  silverBucket: s3.IBucket;
  goldBucket: s3.IBucket;
  awsUtilsLayer: lambda.ILayerVersion;
}

// datalake domain — presigned-URL functions fronting the medallion lake:
//   POST /datalake/upload-url   -> uploadUrlFunction   (bronze read/write)
//   GET  /datalake/download-url -> downloadUrlFunction  (read on all 3 layers)
// Both derive the users/{sub}/ prefix from the verified Cognito claim, so the
// IAM grants are per-bucket and the tenancy check lives in the handlers.
export class DataLakeFunctions extends Construct {
  public readonly uploadUrlFunction: lambda.Function;
  public readonly downloadUrlFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: DataLakeFunctionsProps) {
    super(scope, id);

    const baseLambdaPath = path.join(__dirname, '../../../../../apps/apis/datalake');

    this.uploadUrlFunction = new lambda.Function(this, 'UploadUrlFunction', {
      functionName: `${props.resourcePrefix}-datalake-upload-url`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get_upload_url.lambda_handler',
      code: lambda.Code.fromAsset(path.join(baseLambdaPath, 'create')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      layers: [props.awsUtilsLayer],
      environment: {
        BRONZE_BUCKET_NAME: props.bronzeBucket.bucketName,
      },
      logGroup: new logs.LogGroup(this, 'UploadUrlLogGroup', {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-datalake-upload-url`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    this.downloadUrlFunction = new lambda.Function(this, 'DownloadUrlFunction', {
      functionName: `${props.resourcePrefix}-datalake-download-url`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'get_download_url.lambda_handler',
      code: lambda.Code.fromAsset(path.join(baseLambdaPath, 'read')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      layers: [props.awsUtilsLayer],
      environment: {
        BRONZE_BUCKET_NAME: props.bronzeBucket.bucketName,
        SILVER_BUCKET_NAME: props.silverBucket.bucketName,
        GOLD_BUCKET_NAME: props.goldBucket.bucketName,
      },
      logGroup: new logs.LogGroup(this, 'DownloadUrlLogGroup', {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-datalake-download-url`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Presigned PUT lands in bronze only; presigned GET reads any layer.
    props.bronzeBucket.grantReadWrite(this.uploadUrlFunction);
    props.bronzeBucket.grantRead(this.downloadUrlFunction);
    props.silverBucket.grantRead(this.downloadUrlFunction);
    props.goldBucket.grantRead(this.downloadUrlFunction);
  }
}
