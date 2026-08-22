import * as cdk from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as path from 'path';
import { Construct } from 'constructs';

// Titan Text Embeddings v2 produces 1024-dim vectors (must match the S3
// vector index dimension in VectorStore.ts).
const EMBEDDING_MODEL_ID = 'amazon.titan-embed-text-v2:0';

// Demo/test topic corpora seeded from infra/seed/<course>/ (one S3 prefix and
// one Bedrock data source per topic). The topic id is what the webapp route
// (topics/:topicId) uses and what the agent passes as topicId.
const COURSES = [
  { topicId: 'phys2001', course: 'quantum_physics', suffix: 'quantum-physics' },
  { topicId: 'arth1000', course: 'art_history', suffix: 'art-history' },
];

export interface KnowledgeBaseProps {
  resourcePrefix: string;
  kbDataBucket: s3.IBucket;
  vectorBucketArn: string;
  vectorIndexArn: string;
  kbTopicsTable: dynamodb.ITable;
}

export class KnowledgeBase extends Construct {
  public readonly knowledgeBaseId: string;
  public readonly knowledgeBaseArn: string;

  constructor(scope: Construct, id: string, props: KnowledgeBaseProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);
    const embeddingModelArn = `arn:aws:bedrock:${stack.region}::foundation-model/${EMBEDDING_MODEL_ID}`;
    const kbArnWildcard = `arn:aws:bedrock:${stack.region}:${stack.account}:knowledge-base/*`;
    const seedPath = path.join(__dirname, '../../../../../seed');

    // KB service role — passed to Bedrock at KB-create time (ingestion +
    // retrieval), confused-deputy guarded to this account's knowledge bases.
    const kbServiceRole = new iam.Role(this, 'ServiceRole', {
      roleName: `${props.resourcePrefix}-kb-service-role`,
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': stack.account },
          ArnLike: { 'aws:SourceArn': kbArnWildcard },
        },
      }),
    });

    kbServiceRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'InvokeEmbeddingModel',
        actions: ['bedrock:InvokeModel'],
        resources: [embeddingModelArn],
      })
    );

    props.kbDataBucket.grantRead(kbServiceRole);

    kbServiceRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'VectorStore',
        actions: [
          's3vectors:GetIndex',
          's3vectors:QueryVectors',
          's3vectors:PutVectors',
          's3vectors:GetVectors',
          's3vectors:DeleteVectors',
        ],
        resources: [props.vectorIndexArn],
      })
    );

    // Bedrock Knowledge Base — Amazon S3 Vectors store, Titan v2 embeddings.
    // Bedrock manages the field layout inside the S3 vector index; it writes
    // the raw text and its source metadata (incl. the reserved
    // x-amz-bedrock-kb-data-source-id key the kb tool filters on) as vector
    // metadata during ingestion.
    const knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'Resource', {
      name: `${props.resourcePrefix}-kb`,
      roleArn: kbServiceRole.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn,
          embeddingModelConfiguration: {
            bedrockEmbeddingModelConfiguration: {
              dimensions: 1024,
              embeddingDataType: 'FLOAT32',
            },
          },
        },
      },
      storageConfiguration: {
        type: 'S3_VECTORS',
        s3VectorsConfiguration: {
          indexArn: props.vectorIndexArn,
        },
      },
    });
    // IAM is eventually consistent — make sure the role + policy exist first.
    knowledgeBase.node.addDependency(kbServiceRole);

    this.knowledgeBaseId = knowledgeBase.attrKnowledgeBaseId;
    this.knowledgeBaseArn = knowledgeBase.attrKnowledgeBaseArn;

    // Upload every lesson document under infra/seed/ to the data bucket,
    // preserving the per-course prefixes the data sources point at. prune so a
    // deleted seed file is removed from the bucket (and drops out of the index
    // on the next ingestion) — matching Terraform's tracked aws_s3_object
    // semantics; nothing but seed docs lives in this bucket.
    const deploySeedDocs = new s3deploy.BucketDeployment(this, 'SeedDocs', {
      sources: [s3deploy.Source.asset(seedPath)],
      destinationBucket: props.kbDataBucket,
      prune: true,
    });

    // kb_sync — fire-and-forget Lambda invoked during deploy (per data source)
    // to start a Bedrock ingestion job whenever that source's seed docs change.
    const kbSyncFunction = new lambda.Function(this, 'KbSyncFunction', {
      functionName: `${props.resourcePrefix}-kb-sync`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'sync.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../../../../apps/apis/kb')),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      logGroup: new logs.LogGroup(this, 'KbSyncLogGroup', {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-kb-sync`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    kbSyncFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'Sync',
        actions: ['bedrock:StartIngestionJob', 'bedrock:ListIngestionJobs'],
        resources: [this.knowledgeBaseArn],
      })
    );

    for (const { topicId, course, suffix } of COURSES) {
      const dataSource = new bedrock.CfnDataSource(this, `DataSource-${course}`, {
        knowledgeBaseId: this.knowledgeBaseId,
        name: `${props.resourcePrefix}-kb-${suffix}`,
        dataSourceConfiguration: {
          type: 'S3',
          s3Configuration: {
            bucketArn: props.kbDataBucket.bucketArn,
            inclusionPrefixes: [`${course}/`],
          },
        },
      });

      // topicId -> dataSourceId mapping consumed by the kb tool. putItem is
      // idempotent, so the same fixed physical id is reused across updates.
      new cr.AwsCustomResource(this, `KbTopicItem-${course}`, {
        onCreate: {
          service: 'DynamoDB',
          action: 'putItem',
          parameters: {
            TableName: props.kbTopicsTable.tableName,
            Item: {
              topicId: { S: topicId },
              dataSourceId: { S: dataSource.attrDataSourceId },
            },
          },
          physicalResourceId: cr.PhysicalResourceId.of(`kb-topic-${topicId}`),
        },
        onUpdate: {
          service: 'DynamoDB',
          action: 'putItem',
          parameters: {
            TableName: props.kbTopicsTable.tableName,
            Item: {
              topicId: { S: topicId },
              dataSourceId: { S: dataSource.attrDataSourceId },
            },
          },
          physicalResourceId: cr.PhysicalResourceId.of(`kb-topic-${topicId}`),
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ['dynamodb:PutItem'],
            resources: [props.kbTopicsTable.tableArn],
          }),
        ]),
      });

      // Auto-index the data source during deploy. docs_hash (a digest of the
      // course's seed docs) is baked into the call parameters, so a fresh
      // ingestion job fires only for the source whose seed docs changed.
      // Known difference from Terraform: a sync.py FUNCTION error surfaces as
      // FunctionError in the invoke response, which AwsCustomResource cannot
      // inspect — the deploy proceeds (Terraform's aws_lambda_invocation would
      // fail the apply). Check the kb-sync logs if ingestion looks stale.
      const docsHash = cdk.FileSystem.fingerprint(path.join(seedPath, course));
      const syncPayload = {
        knowledge_base_id: this.knowledgeBaseId,
        data_source_id: dataSource.attrDataSourceId,
        docs_hash: docsHash,
      };
      const ingestion = new cr.AwsCustomResource(this, `Ingestion-${course}`, {
        onCreate: {
          service: 'Lambda',
          action: 'invoke',
          parameters: {
            FunctionName: kbSyncFunction.functionName,
            Payload: cdk.Stack.of(this).toJsonString(syncPayload),
          },
          physicalResourceId: cr.PhysicalResourceId.of(`kb-ingestion-${course}`),
        },
        onUpdate: {
          service: 'Lambda',
          action: 'invoke',
          parameters: {
            FunctionName: kbSyncFunction.functionName,
            Payload: cdk.Stack.of(this).toJsonString(syncPayload),
          },
          physicalResourceId: cr.PhysicalResourceId.of(`kb-ingestion-${course}`),
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ['lambda:InvokeFunction'],
            resources: [kbSyncFunction.functionArn],
          }),
        ]),
      });
      // Ingestion must see the uploaded docs and the registered data source.
      ingestion.node.addDependency(deploySeedDocs);
      ingestion.node.addDependency(dataSource);
    }
  }
}
