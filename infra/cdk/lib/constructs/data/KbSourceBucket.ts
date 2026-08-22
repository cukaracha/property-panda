import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface KbSourceBucketProps {
  resourcePrefix: string;
}

export class KbSourceBucket extends Construct {
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: KbSourceBucketProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    // KB source-document bucket (one prefix per course). The AI stack's
    // KnowledgeBase construct uploads the seed docs and points the Bedrock
    // data sources at these prefixes.
    this.bucket = new s3.Bucket(this, 'Bucket', {
      bucketName: `${props.resourcePrefix}-kb-data-${stack.account}-${stack.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
  }
}
