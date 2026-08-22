import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { KbSourceBucket } from './constructs/data/KbSourceBucket';
import { DataBuckets } from './constructs/data/DataBuckets';
import { DataLake } from './constructs/data/DataLake';

interface DataStackProps extends cdk.StackProps {
  resourcePrefix: string;
  allowedOrigins: string[];
}

export class DataStack extends cdk.Stack {
  public readonly kbDataBucket: s3.Bucket;
  public readonly userDataBucket: s3.Bucket;
  public readonly tempBucket: s3.Bucket;
  public readonly bronzeBucket: s3.Bucket;
  public readonly silverBucket: s3.Bucket;
  public readonly goldBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    // KB source-document bucket (one prefix per course). Seed upload and the
    // Bedrock data sources are owned by the AI stack's KnowledgeBase construct.
    const kbSource = new KbSourceBucket(this, 'KbSourceBucket', {
      resourcePrefix: props.resourcePrefix,
    });

    this.kbDataBucket = kbSource.bucket;

    // Browser-facing buckets (durable user data + auto-expiring temp scratch)
    // fronted by the temp_data presigned-URL API in the Api stack.
    const dataBuckets = new DataBuckets(this, 'DataBuckets', {
      resourcePrefix: props.resourcePrefix,
      allowedOrigins: props.allowedOrigins,
    });

    this.userDataBucket = dataBuckets.userDataBucket;
    this.tempBucket = dataBuckets.tempBucket;

    // Medallion lake behind the ontology feature — raw uploads in bronze,
    // converted markdown in silver, ontology outputs in gold, each under a
    // users/{sub}/ prefix.
    const dataLake = new DataLake(this, 'DataLake', {
      resourcePrefix: props.resourcePrefix,
      allowedOrigins: props.allowedOrigins,
    });

    this.bronzeBucket = dataLake.bronzeBucket;
    this.silverBucket = dataLake.silverBucket;
    this.goldBucket = dataLake.goldBucket;

    new cdk.CfnOutput(this, 'UserDataBucketName', {
      value: this.userDataBucket.bucketName,
      description: 'S3 bucket for durable user-data assets',
    });

    new cdk.CfnOutput(this, 'TempBucketName', {
      value: this.tempBucket.bucketName,
      description: 'S3 bucket for temporary uploads (1-day expiry)',
    });

    new cdk.CfnOutput(this, 'BronzeBucketName', {
      value: this.bronzeBucket.bucketName,
      description: 'Medallion lake bronze layer (raw uploads)',
    });

    new cdk.CfnOutput(this, 'SilverBucketName', {
      value: this.silverBucket.bucketName,
      description: 'Medallion lake silver layer (converted markdown)',
    });

    new cdk.CfnOutput(this, 'GoldBucketName', {
      value: this.goldBucket.bucketName,
      description: 'Medallion lake gold layer (ontology outputs)',
    });
  }
}
