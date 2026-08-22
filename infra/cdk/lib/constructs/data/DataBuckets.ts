import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface DataBucketsProps {
  resourcePrefix: string;
  // Browser origins allowed to PUT/GET directly against the buckets via
  // presigned URLs. Sourced from AppConfig.json (allowedOrigins).
  allowedOrigins: string[];
}

// Two browser-facing S3 buckets used by the presigned-URL API (temp_data):
//   - userDataBucket: durable per-user assets.
//   - tempBucket:     scratch uploads, auto-expired after 1 day.
// Both block public access, allow browser PUT/GET from the configured origins
// (ExposeHeaders: ETag so multipart/PUT clients can read the upload ETag), and
// enable S3 Transfer Acceleration (the presigned URLs are minted against the
// accelerate endpoint — see apps/shared/lambda_layers/aws_utils/s3_utils.py).
export class DataBuckets extends Construct {
  public readonly userDataBucket: s3.Bucket;
  public readonly tempBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataBucketsProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    const corsRule: s3.CorsRule = {
      allowedHeaders: ['*'],
      allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
      allowedOrigins: props.allowedOrigins,
      exposedHeaders: ['ETag'],
      maxAge: 3000,
    };

    this.userDataBucket = new s3.Bucket(this, 'UserDataBucket', {
      bucketName: `${props.resourcePrefix}-user-data-${stack.account}-${stack.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      transferAcceleration: true,
      cors: [corsRule],
      // Dev sample — tear the bucket (and its contents) down on stack destroy.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.tempBucket = new s3.Bucket(this, 'TempBucket', {
      bucketName: `${props.resourcePrefix}-temp-${stack.account}-${stack.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      transferAcceleration: true,
      cors: [corsRule],
      // Scratch bucket — objects self-expire one day after upload.
      lifecycleRules: [{ enabled: true, expiration: cdk.Duration.days(1) }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
  }
}
