import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface DataLakeProps {
  resourcePrefix: string;
  // Browser origins allowed to PUT/GET directly against the lake via presigned
  // URLs. Sourced from AppConfig.json (allowedOrigins).
  allowedOrigins: string[];
}

// The medallion data lake behind the ontology feature. One bucket per layer,
// every object under a per-user prefix:
//   bronze: users/{sub}/{buildId}/{assetId}.{ext}       raw uploads
//   silver: users/{sub}/{buildId}/{doc}.md              converted markdown
//   gold:   users/{sub}/{buildId}/{nodes,edges,...}     ontology outputs
//
// Every layer is reachable from the browser through a presigned URL, so every
// layer carries the CORS rule AND transfer acceleration: the browser PUTs into
// bronze, the ontology page GETs its outputs straight out of gold, and silver is
// served by /datalake/download-url. Acceleration is not optional per bucket —
// s3_utils.py mints every presigned URL against the accelerate endpoint, and S3
// answers an unaccelerated bucket there with a 400 that carries no CORS header.
//
// CORS grants nothing: the buckets stay BLOCK_ALL, and each request still needs a
// signature scoped to the caller's own users/{sub}/ prefix.
//
// None of the three has a lifecycle rule — unlike the temp bucket, a stored
// ontology has to survive so a user can retrieve it later.
export class DataLake extends Construct {
  public readonly bronzeBucket: s3.Bucket;
  public readonly silverBucket: s3.Bucket;
  public readonly goldBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataLakeProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    const layerBucket = (constructId: string, layer: string): s3.Bucket =>
      new s3.Bucket(this, constructId, {
        bucketName: `${props.resourcePrefix}-datalake-${layer}-${stack.account}-${stack.region}`,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
        objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
        transferAcceleration: true,
        cors: [
          {
            allowedHeaders: ['*'],
            allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
            allowedOrigins: props.allowedOrigins,
            exposedHeaders: ['ETag'],
            maxAge: 3000,
          },
        ],
        // Reclaim the storage behind uploads the browser abandoned mid-flight.
        lifecycleRules: [
          { enabled: true, abortIncompleteMultipartUploadAfter: cdk.Duration.days(7) },
        ],
        // Dev sample — tear the bucket (and its contents) down on stack destroy.
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      });

    this.bronzeBucket = layerBucket('BronzeBucket', 'bronze');
    this.silverBucket = layerBucket('SilverBucket', 'silver');
    this.goldBucket = layerBucket('GoldBucket', 'gold');
  }
}
