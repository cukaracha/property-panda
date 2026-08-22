import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as path from 'path';
import { Construct } from 'constructs';

export interface OntologyDeleteFunctionsProps {
  resourcePrefix: string;
  awsUtilsLayer: lambda.ILayerVersion;
  jobTable: dynamodb.ITable;
  bronzeBucket: s3.IBucket;
  silverBucket: s3.IBucket;
  goldBucket: s3.IBucket;
  // The convert state machine, whose executions are named after the jobId — that is
  // what lets the worker abort a build that is still running.
  convertStateMachineArn: string;
  vectorBucketArn: string;
  vectorBucketName: string;
  vectorIndexArn: string;
  vectorIndexName: string;
  // Ontology chat AgentCore Memory (from the Ai stack) — the conversations held
  // about the build being deleted. id → MEMORY_ID env; arn → scoped IAM.
  memoryId: string;
  memoryArn: string;
}

// ontology domain, delete side — tears an ontology build down completely:
//   DELETE /ontology/builds/{jobId} -> deleteFunction (202) -> purgeFunction (async)
//
// Split in two because a build's footprint spans six services and a large one is
// thousands of objects, far past API Gateway's 29 second ceiling. The API-facing
// Lambda only proves ownership, parks the row at `deleting` and hands off; the
// worker does the teardown and either drops the row or parks it at `deleteFailed`
// with the reason, which is what makes a failed purge visible and retryable.
//
// The worker is invoked directly with InvocationType="Event" rather than through an
// SQS FIFO queue like the markdown converter: there is one job per build, no
// ordering requirement, and the `deleteFailed` row is a better retry surface than a
// DLQ the user cannot see.
export class OntologyDeleteFunctions extends Construct {
  public readonly deleteFunction: lambda.Function;
  public readonly purgeFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: OntologyDeleteFunctionsProps) {
    super(scope, id);

    const baseLambdaPath = path.join(__dirname, '../../../../../apps/apis/ontology/delete');

    this.purgeFunction = new lambda.Function(this, 'PurgeFunction', {
      functionName: `${props.resourcePrefix}-ontology-purge`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'purge_ontology.lambda_handler',
      code: lambda.Code.fromAsset(baseLambdaPath, { exclude: ['__pycache__/**'] }),
      // Listing and deleting a large build's objects is the slow part.
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      layers: [props.awsUtilsLayer],
      environment: {
        JOB_TABLE: props.jobTable.tableName,
        BRONZE_BUCKET_NAME: props.bronzeBucket.bucketName,
        SILVER_BUCKET_NAME: props.silverBucket.bucketName,
        GOLD_BUCKET_NAME: props.goldBucket.bucketName,
        VECTOR_BUCKET: props.vectorBucketName,
        VECTOR_INDEX: props.vectorIndexName,
        STATE_MACHINE_ARN: props.convertStateMachineArn,
        MEMORY_ID: props.memoryId,
      },
      logGroup: new logs.LogGroup(this, 'PurgeLogGroup', {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-ontology-purge`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Read the row to confirm the build exists, park it on failure, drop it on success.
    props.jobTable.grantReadWriteData(this.purgeFunction);

    // The build's own prefix in all three lake buckets, plus the map-results tree
    // that only ever exists in gold.
    props.bronzeBucket.grantDelete(this.purgeFunction);
    props.bronzeBucket.grantRead(this.purgeFunction);
    props.silverBucket.grantDelete(this.purgeFunction);
    props.silverBucket.grantRead(this.purgeFunction);
    props.goldBucket.grantDelete(this.purgeFunction);
    props.goldBucket.grantRead(this.purgeFunction);

    // No grant method exists for S3 Vectors, Step Functions StopExecution or the
    // AgentCore data-plane, so all three are explicit statements.
    //
    // ListVectors takes no metadata filter, so the whole index is scanned and the
    // build's windows are picked out by their key prefix.
    this.purgeFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'PageVectors',
        actions: ['s3vectors:ListVectors', 's3vectors:DeleteVectors'],
        resources: [props.vectorBucketArn, props.vectorIndexArn],
      })
    );

    // Cancel a build that is still running. The execution name is the jobId, which
    // is the only reason one build's execution can be addressed.
    const stack = cdk.Stack.of(this);
    this.purgeFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'StopBuild',
        actions: ['states:DescribeExecution', 'states:StopExecution'],
        resources: [
          `arn:aws:states:${stack.region}:${stack.account}:execution:${props.resourcePrefix}-ontology-convert:*`,
        ],
      })
    );

    // Erase the conversations held about this build.
    this.purgeFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'ChatHistory',
        actions: [
          'bedrock-agentcore:ListSessions',
          'bedrock-agentcore:ListEvents',
          'bedrock-agentcore:DeleteEvent',
        ],
        resources: [props.memoryArn, `${props.memoryArn}/*`],
      })
    );

    this.deleteFunction = new lambda.Function(this, 'DeleteFunction', {
      functionName: `${props.resourcePrefix}-ontology-delete`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'delete_ontology.lambda_handler',
      code: lambda.Code.fromAsset(baseLambdaPath, { exclude: ['__pycache__/**'] }),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      layers: [props.awsUtilsLayer],
      environment: {
        JOB_TABLE: props.jobTable.tableName,
        PURGE_FUNCTION_NAME: this.purgeFunction.functionName,
      },
      logGroup: new logs.LogGroup(this, 'DeleteLogGroup', {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-ontology-delete`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Prove ownership, then mark the row deleting. Only the worker may drop a row,
    // and only after everything else is gone.
    props.jobTable.grantReadWriteData(this.deleteFunction);
    this.purgeFunction.grantInvoke(this.deleteFunction);
  }
}
