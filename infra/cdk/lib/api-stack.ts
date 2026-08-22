import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';
import { ApiGateway } from './constructs/api/ApiGateway';
import { ConversationsFunctions } from './constructs/api/ConversationsFunctions';
import { OntologyConversationsFunctions } from './constructs/api/OntologyConversationsFunctions';
import { OntologyDeleteFunctions } from './constructs/api/OntologyDeleteFunctions';
import { OntologyUpdateFunctions } from './constructs/api/OntologyUpdateFunctions';
import { Converter } from './constructs/api/Converter';
import { DataLakeFunctions } from './constructs/api/DataLakeFunctions';
import { TempDataFunctions } from './constructs/api/TempDataFunctions';

interface ApiStackProps extends cdk.StackProps {
  stage: string;
  resourcePrefix: string;
  userPool: cognito.IUserPool;
  selfSignupFunction: lambda.IFunction;
  randomNumberFunction: lambda.IFunction;
  webSearchFunction: lambda.IFunction;
  webRetrieveFunction: lambda.IFunction;
  ontologyStartFunction: lambda.IFunction;
  ontologyStatusFunction: lambda.IFunction;
  ontologyListFunction: lambda.IFunction;
  ontologyOutputsFunction: lambda.IFunction;
  // What the purge worker needs to tear a build down. The three lake buckets it
  // also clears are already props below.
  ontologyJobTable: dynamodb.ITable;
  ontologyConvertStateMachineArn: string;
  // The state machine itself, which the corpus-update Lambda starts an execution on.
  // The purge worker only needs the ARN, so both forms cross the boundary.
  ontologyConvertStateMachine: stepfunctions.IStateMachine;
  // Checked before a corpus update seeds a build, same as the start Lambda does.
  claudeTokensSecret: secretsmanager.ISecret;
  ontologyVectorBucketArn: string;
  ontologyVectorBucketName: string;
  ontologyVectorIndexArn: string;
  ontologyVectorIndexName: string;
  chatMemoryId: string;
  chatMemoryArn: string;
  ontologyChatMemoryId: string;
  ontologyChatMemoryArn: string;
  tempBucket: s3.IBucket;
  bronzeBucket: s3.IBucket;
  silverBucket: s3.IBucket;
  goldBucket: s3.IBucket;
  apiKeysSecret: secretsmanager.ISecret;
  listUsersFunction: lambda.IFunction;
  createUserFunction: lambda.IFunction;
  updateUserFunction: lambda.IFunction;
  deleteUserFunction: lambda.IFunction;
  getClaudeTokenFunction: lambda.IFunction;
  putClaudeTokenFunction: lambda.IFunction;
}

export class ApiStack extends cdk.Stack {
  public readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // aws_utils layer shared from CoreStack via SSM (same pattern as AiStack) —
    // a CloudFormation export cannot change while imported, which would block
    // re-publishing the layer. Ordering comes from api.addDependency(core).
    const awsUtilsLayerArn = ssm.StringParameter.valueForStringParameter(
      this,
      `/${props.resourcePrefix}/layers/aws-utils-arn`
    );
    const awsUtilsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      'AwsUtilsLayer',
      awsUtilsLayerArn
    );

    // temp_data presigned-URL functions (own the temp bucket from the Data stack).
    const tempData = new TempDataFunctions(this, 'TempData', {
      resourcePrefix: props.resourcePrefix,
      tempBucket: props.tempBucket,
      awsUtilsLayer,
    });

    // datalake presigned-URL functions over the medallion lake (Data stack).
    // Uploads land in bronze; downloads are scoped to the caller's own prefix.
    const dataLake = new DataLakeFunctions(this, 'DataLake', {
      resourcePrefix: props.resourcePrefix,
      bronzeBucket: props.bronzeBucket,
      silverBucket: props.silverBucket,
      goldBucket: props.goldBucket,
      awsUtilsLayer,
    });

    // markdown_converter async job pipeline (table + FIFO queue/DLQ + container
    // worker + trigger/status Lambdas). The ApiKeys secret is threaded from the
    // Ai stack as a typed prop; the temp bucket comes from the Data stack.
    const converter = new Converter(this, 'Converter', {
      resourcePrefix: props.resourcePrefix,
      tempBucket: props.tempBucket,
      bronzeBucket: props.bronzeBucket,
      silverBucket: props.silverBucket,
      apiKeysSecret: props.apiKeysSecret,
      awsUtilsLayer,
    });

    // conversations read-only proxies over the chat AgentCore Memory (id/arn
    // threaded from the Ai stack) — let a user browse and replay past sessions.
    const conversations = new ConversationsFunctions(this, 'Conversations', {
      resourcePrefix: props.resourcePrefix,
      awsUtilsLayer,
      memoryId: props.chatMemoryId,
      memoryArn: props.chatMemoryArn,
    });

    // The same pattern over the ontology chat agent's own memory — past
    // conversations about one finished ontology, scoped to that build.
    const ontologyConversations = new OntologyConversationsFunctions(
      this,
      'OntologyConversations',
      {
        resourcePrefix: props.resourcePrefix,
        awsUtilsLayer,
        memoryId: props.ontologyChatMemoryId,
        memoryArn: props.ontologyChatMemoryArn,
      }
    );

    // Deleting an ontology: a 202 from the API-facing Lambda, then an async worker
    // that clears the build out of every service it touched.
    const ontologyDelete = new OntologyDeleteFunctions(this, 'OntologyDelete', {
      resourcePrefix: props.resourcePrefix,
      awsUtilsLayer,
      jobTable: props.ontologyJobTable,
      bronzeBucket: props.bronzeBucket,
      silverBucket: props.silverBucket,
      goldBucket: props.goldBucket,
      convertStateMachineArn: props.ontologyConvertStateMachineArn,
      vectorBucketArn: props.ontologyVectorBucketArn,
      vectorBucketName: props.ontologyVectorBucketName,
      vectorIndexArn: props.ontologyVectorIndexArn,
      vectorIndexName: props.ontologyVectorIndexName,
      memoryId: props.ontologyChatMemoryId,
      memoryArn: props.ontologyChatMemoryArn,
    });

    // Updating an ontology's corpus: derives a NEW build over the changed document
    // set and lets the state machine's first stage carry the unchanged work over.
    const ontologyUpdate = new OntologyUpdateFunctions(this, 'OntologyUpdate', {
      resourcePrefix: props.resourcePrefix,
      awsUtilsLayer,
      jobTable: props.ontologyJobTable,
      bronzeBucket: props.bronzeBucket,
      silverBucket: props.silverBucket,
      goldBucket: props.goldBucket,
      convertStateMachine: props.ontologyConvertStateMachine,
      claudeTokensSecret: props.claudeTokensSecret,
    });

    const api = new ApiGateway(this, 'Api', {
      stage: props.stage,
      resourcePrefix: props.resourcePrefix,
      userPool: props.userPool,
      selfSignupFunction: props.selfSignupFunction,
      randomNumberFunction: props.randomNumberFunction,
      webSearchFunction: props.webSearchFunction,
      webRetrieveFunction: props.webRetrieveFunction,
      uploadUrlFunction: tempData.uploadUrlFunction,
      downloadUrlFunction: tempData.downloadUrlFunction,
      datalakeUploadUrlFunction: dataLake.uploadUrlFunction,
      datalakeDownloadUrlFunction: dataLake.downloadUrlFunction,
      listUsersFunction: props.listUsersFunction,
      createUserFunction: props.createUserFunction,
      updateUserFunction: props.updateUserFunction,
      deleteUserFunction: props.deleteUserFunction,
      getClaudeTokenFunction: props.getClaudeTokenFunction,
      putClaudeTokenFunction: props.putClaudeTokenFunction,
      triggerConversionFunction: converter.triggerFunction,
      getConversionStatusFunction: converter.statusFunction,
      ontologyStartFunction: props.ontologyStartFunction,
      ontologyStatusFunction: props.ontologyStatusFunction,
      ontologyListFunction: props.ontologyListFunction,
      ontologyOutputsFunction: props.ontologyOutputsFunction,
      ontologyDeleteFunction: ontologyDelete.deleteFunction,
      ontologyUpdateFunction: ontologyUpdate.updateFunction,
      ontologyPublishFunction: ontologyUpdate.publishFunction,
      ontologyReviewFunction: ontologyUpdate.reviewFunction,
      listConversationsFunction: conversations.listFunction,
      getConversationFunction: conversations.getFunction,
      listOntologyConversationsFunction: ontologyConversations.listFunction,
      getOntologyConversationFunction: ontologyConversations.getFunction,
    });

    this.apiEndpoint = api.apiEndpoint;

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.apiEndpoint,
      description: 'API Gateway Endpoint',
    });
  }
}
