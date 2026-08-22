import * as s3vectors from 'aws-cdk-lib/aws-s3vectors';
import { Construct } from 'constructs';

export interface VectorStoreProps {
  resourcePrefix: string;
}

// Shared vector store — Amazon S3 Vectors (vector bucket + index). S3 Vectors
// is a fully managed, serverless vector store: Bedrock writes embeddings into
// the index during ingestion and queries it at retrieval time. Default SSE-S3.
export class VectorStore extends Construct {
  public readonly vectorBucketArn: string;
  public readonly indexArn: string;
  public readonly indexName: string;

  constructor(scope: Construct, id: string, props: VectorStoreProps) {
    super(scope, id);

    const vectorBucket = new s3vectors.CfnVectorBucket(this, 'VectorBucket', {
      vectorBucketName: `${props.resourcePrefix}-kb-vectors`,
    });

    const index = new s3vectors.CfnIndex(this, 'Index', {
      vectorBucketArn: vectorBucket.attrVectorBucketArn,
      indexName: 'kb-main',
      dataType: 'float32',
      // Must match the embedding model (Titan Text Embeddings v2 -> 1024).
      dimension: 1024,
      distanceMetric: 'cosine',
      metadataConfiguration: {
        // Only these two Bedrock-managed keys are non-filterable. The reserved
        // x-amz-bedrock-kb-data-source-id key (which the kb tool filters
        // retrieval on) and any user metadata stay FILTERABLE by omission.
        nonFilterableMetadataKeys: ['AMAZON_BEDROCK_TEXT', 'AMAZON_BEDROCK_METADATA'],
      },
    });

    this.vectorBucketArn = vectorBucket.attrVectorBucketArn;
    this.indexArn = index.attrIndexArn;
    this.indexName = 'kb-main';
  }
}
