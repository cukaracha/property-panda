import * as s3vectors from 'aws-cdk-lib/aws-s3vectors';
import { Construct } from 'constructs';

export interface OntologyVectorStoreProps {
  resourcePrefix: string;
}

// The page index every built ontology is searched through — Amazon S3 Vectors
// (vector bucket + index), written directly rather than through a Bedrock
// Knowledge Base.
//
// No KB, deliberately. A KB owns its own chunking, so its chunk ids would not
// map to the chunk ids in nodes.csv and the node-to-chunk join would break; it
// ingests asynchronously, so a finished build would not be searchable until an
// ingestion job it does not control had run; and one job per data source means
// concurrent builds contend. Writing vectors directly costs a PutVectors call
// and removes all three problems.
//
// One index for every build in the stage. A query filters on buildId, and the
// vector keys carry it too, so two builds over the same corpus (which produce
// the same page ids) cannot collide.
export class OntologyVectorStore extends Construct {
  public readonly vectorBucketArn: string;
  public readonly vectorBucketName: string;
  public readonly indexArn: string;
  public readonly indexName: string;

  constructor(scope: Construct, id: string, props: OntologyVectorStoreProps) {
    super(scope, id);

    const vectorBucketName = `${props.resourcePrefix}-ontology-vectors`;
    const indexName = 'ontology-pages';

    const vectorBucket = new s3vectors.CfnVectorBucket(this, 'VectorBucket', {
      vectorBucketName,
    });

    const index = new s3vectors.CfnIndex(this, 'Index', {
      vectorBucketArn: vectorBucket.attrVectorBucketArn,
      indexName,
      dataType: 'float32',
      // Must match the embedding model (Titan Text Embeddings v2 -> 1024).
      dimension: 1024,
      distanceMetric: 'cosine',
      metadataConfiguration: {
        // Everything a query filters on (buildId, userSub, pageId, docId) stays
        // FILTERABLE by omission. The window text and the document title are
        // payload the caller reads off the hit, never predicates.
        nonFilterableMetadataKeys: ['text', 'docTitle'],
      },
    });

    this.vectorBucketArn = vectorBucket.attrVectorBucketArn;
    this.vectorBucketName = vectorBucketName;
    this.indexArn = index.attrIndexArn;
    this.indexName = indexName;
  }
}
