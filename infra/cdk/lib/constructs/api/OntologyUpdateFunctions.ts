import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as path from 'path';
import { Construct } from 'constructs';

export interface OntologyUpdateFunctionsProps {
  resourcePrefix: string;
  awsUtilsLayer: lambda.ILayerVersion;
  jobTable: dynamodb.ITable;
  bronzeBucket: s3.IBucket;
  silverBucket: s3.IBucket;
  goldBucket: s3.IBucket;
  // The convert state machine itself, not just its ARN: this Lambda starts an
  // execution on it, which needs the grant method rather than a bare resource.
  convertStateMachine: stepfunctions.IStateMachine;
  // The caller's own Claude subscription token, checked before a build is seeded.
  claudeTokensSecret: secretsmanager.ISecret;
}

// ontology domain, write side — derives a new build, and shares one:
//   POST   /ontology/builds/{jobId}/corpus  -> updateFunction (202, the NEW jobId)
//   POST   /ontology/builds/{jobId}/redrive -> updateFunction (202, the NEW jobId)
//   POST   /ontology/builds/{jobId}/publish -> publishFunction
//   DELETE /ontology/builds/{jobId}/publish -> publishFunction
//   POST   /ontology/builds/{jobId}/review  -> reviewFunction
//
// One Lambda for both, because a redrive is a corpus update that keeps every document
// and adds none: the carry-forward stage hands back only what never converted and the
// extraction plan fans out only the pages with no elements, so a retry costs exactly
// the work that was lost.
//
// An update does not mutate the source ontology. It seeds a second build alongside
// it and hands the state machine a carryFrom pointer, and the machine's first stage
// (the carry-forward Lambda, owned by OntologyAgent in the Ai stack) copies each
// kept document's markdown and extracted elements into the new prefix. CONVERT then
// runs over the added documents only, and the extraction fan-out skips every carried
// page. Extraction is the whole cost of a build, so that skip is the feature.
//
// One Lambda rather than the trigger-plus-worker split the delete side uses: all the
// bulk copying happens inside the state machine, so what is left here is a row write
// and a StartExecution, both well inside API Gateway's 29 second ceiling.
//
// Publishing is a second Lambda over the same asset, and is smaller still: sharing an
// ontology moves nothing, because every read path already resolves a build's prefix
// from its job row rather than from the caller, so all it writes is the attribute
// pair the by_visibility index is keyed on.
//
// Reviewing is a third. It is the only route in the domain that talks to a RUNNING
// build: a conversion that lost documents parks the execution on a task token, and this
// is what sends that token back with the user's answer.
export class OntologyUpdateFunctions extends Construct {
  public readonly updateFunction: lambda.Function;
  public readonly publishFunction: lambda.Function;
  public readonly reviewFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: OntologyUpdateFunctionsProps) {
    super(scope, id);

    const baseLambdaPath = path.join(__dirname, '../../../../../apps/apis/ontology/update');

    this.updateFunction = new lambda.Function(this, 'UpdateFunction', {
      functionName: `${props.resourcePrefix}-ontology-update`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'update_corpus.lambda_handler',
      code: lambda.Code.fromAsset(baseLambdaPath, { exclude: ['__pycache__/**'] }),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      layers: [props.awsUtilsLayer],
      environment: {
        JOB_TABLE: props.jobTable.tableName,
        BRONZE_BUCKET_NAME: props.bronzeBucket.bucketName,
        SILVER_BUCKET_NAME: props.silverBucket.bucketName,
        GOLD_BUCKET_NAME: props.goldBucket.bucketName,
        STATE_MACHINE_ARN: props.convertStateMachine.stateMachineArn,
        CLAUDE_TOKENS_SECRET: props.claudeTokensSecret.secretArn,
      },
      logGroup: new logs.LogGroup(this, 'UpdateLogGroup', {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-ontology-update`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Read the source row to prove ownership and resolve the kept documents' names,
    // write the derived row, and drop it again if the execution will not start.
    props.jobTable.grantReadWriteData(this.updateFunction);

    // Schema reuse copies the source build's schema.json into the new run prefix.
    // Done here rather than in carry-forward so an ontology with no schema is
    // refused as a 400 instead of failing the build minutes later.
    props.goldBucket.grantReadWrite(this.updateFunction);

    props.convertStateMachine.grantStartExecution(this.updateFunction);
    props.claudeTokensSecret.grantRead(this.updateFunction);

    this.publishFunction = new lambda.Function(this, 'PublishFunction', {
      functionName: `${props.resourcePrefix}-ontology-publish`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'publish_ontology.lambda_handler',
      code: lambda.Code.fromAsset(baseLambdaPath, { exclude: ['__pycache__/**'] }),
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      layers: [props.awsUtilsLayer],
      environment: {
        JOB_TABLE: props.jobTable.tableName,
      },
      logGroup: new logs.LogGroup(this, 'PublishLogGroup', {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-ontology-publish`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Read the row to prove ownership, then set or clear the visibility pair. No
    // bucket at all: publishing an ontology does not touch a single object.
    props.jobTable.grantReadWriteData(this.publishFunction);

    this.reviewFunction = new lambda.Function(this, 'ReviewFunction', {
      functionName: `${props.resourcePrefix}-ontology-review`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'review_build.lambda_handler',
      code: lambda.Code.fromAsset(baseLambdaPath, { exclude: ['__pycache__/**'] }),
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      layers: [props.awsUtilsLayer],
      environment: {
        JOB_TABLE: props.jobTable.tableName,
      },
      logGroup: new logs.LogGroup(this, 'ReviewLogGroup', {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-ontology-review`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Read the row for the token and the failed documents, write the corpus a retry
    // chose. No bucket either: replacements are uploaded straight to bronze through the
    // presign endpoint, and this only records the keys.
    props.jobTable.grantReadWriteData(this.reviewFunction);

    // Sending a task token back is not scoped to a state machine. The token is opaque
    // and carries its own execution, so these two actions take no resource ARN, which
    // is also why there is no grant method to use instead.
    this.reviewFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'AnswerBuildReviewGate',
        actions: ['states:SendTaskSuccess', 'states:SendTaskFailure'],
        resources: ['*'],
      })
    );
  }
}
