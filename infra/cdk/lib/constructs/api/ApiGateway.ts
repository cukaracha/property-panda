import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface ApiGatewayProps {
  stage: string;
  resourcePrefix: string;
  userPool: cognito.IUserPool;
  selfSignupFunction: lambda.IFunction;
  randomNumberFunction: lambda.IFunction;
  webSearchFunction: lambda.IFunction;
  webRetrieveFunction: lambda.IFunction;
  uploadUrlFunction: lambda.IFunction;
  downloadUrlFunction: lambda.IFunction;
  datalakeUploadUrlFunction: lambda.IFunction;
  datalakeDownloadUrlFunction: lambda.IFunction;
  listUsersFunction: lambda.IFunction;
  createUserFunction: lambda.IFunction;
  updateUserFunction: lambda.IFunction;
  deleteUserFunction: lambda.IFunction;
  getClaudeTokenFunction: lambda.IFunction;
  putClaudeTokenFunction: lambda.IFunction;
  triggerConversionFunction: lambda.IFunction;
  getConversionStatusFunction: lambda.IFunction;
  ontologyStartFunction: lambda.IFunction;
  ontologyStatusFunction: lambda.IFunction;
  ontologyListFunction: lambda.IFunction;
  ontologyOutputsFunction: lambda.IFunction;
  ontologyDeleteFunction: lambda.IFunction;
  ontologyUpdateFunction: lambda.IFunction;
  ontologyPublishFunction: lambda.IFunction;
  ontologyReviewFunction: lambda.IFunction;
  listConversationsFunction: lambda.IFunction;
  getConversationFunction: lambda.IFunction;
  listOntologyConversationsFunction: lambda.IFunction;
  getOntologyConversationFunction: lambda.IFunction;
}

// REST API front door:
//   GET    /random-number         -> Cognito-authorized -> random_number tool Lambda
//   POST   /web-search            -> Cognito-authorized -> web_search tool Lambda
//   POST   /web-retrieve          -> Cognito-authorized -> web_retrieve tool Lambda
//   POST   /users/signup          -> public             -> self_signup Lambda
//   POST   /temp-data/upload-url   -> Cognito-authorized -> get_upload_url Lambda
//   GET    /temp-data/download-url -> Cognito-authorized -> get_download_url Lambda
//   POST   /datalake/upload-url    -> Cognito-authorized -> datalake get_upload_url Lambda
//   GET    /datalake/download-url  -> Cognito-authorized -> datalake get_download_url Lambda
//   GET    /admin/users            -> Cognito-authorized -> list_users Lambda
//   POST   /admin/users            -> Cognito-authorized -> create_user Lambda
//   PUT    /admin/users            -> Cognito-authorized -> update_user Lambda
//   DELETE /admin/users            -> Cognito-authorized -> delete_user Lambda
//   GET    /profile/claude-token   -> Cognito-authorized -> get_claude_token Lambda
//   PUT    /profile/claude-token   -> Cognito-authorized -> put_claude_token Lambda
//   POST   /converter/convert      -> Cognito-authorized -> trigger_conversion Lambda
//   GET    /converter/status       -> Cognito-authorized -> get_conversion_status Lambda
//   POST   /ontology/build         -> Cognito-authorized -> start_build Lambda
//   GET    /ontology/status        -> Cognito-authorized -> get_build_status Lambda
//   GET    /ontology/builds         -> Cognito-authorized -> list_builds Lambda
//   GET    /ontology/builds/{jobId}/outputs -> Cognito-authorized -> get_build_outputs Lambda
//   DELETE /ontology/builds/{jobId} -> Cognito-authorized -> delete_ontology Lambda
//   POST   /ontology/builds/{jobId}/corpus -> Cognito-authorized -> update_corpus Lambda
//   POST   /ontology/builds/{jobId}/redrive -> Cognito-authorized -> update_corpus Lambda
//   POST   /ontology/builds/{jobId}/publish -> Cognito-authorized -> publish_ontology Lambda
//   DELETE /ontology/builds/{jobId}/publish -> Cognito-authorized -> publish_ontology Lambda
//   POST   /ontology/builds/{jobId}/review -> Cognito-authorized -> review_build Lambda
//   GET    /ontology/builds/{jobId}/conversations -> Cognito-authorized -> list_ontology_conversations Lambda
//   GET    /ontology/builds/{jobId}/conversations/{sessionId} -> Cognito-authorized -> get_ontology_conversation Lambda
//   GET    /conversations          -> Cognito-authorized -> list_conversations Lambda
//   GET    /conversations/{sessionId} -> Cognito-authorized -> get_conversation Lambda
// CORS preflight comes from defaultCorsPreflightOptions; gateway responses add
// CORS headers to authorizer/4xx/5xx errors so the browser surfaces real errors.
export class ApiGateway extends Construct {
  public readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: ApiGatewayProps) {
    super(scope, id);

    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: `${props.resourcePrefix}-api`,
      description: 'REST front door for the SPA (Cognito-authorized).',
      endpointConfiguration: { types: [apigateway.EndpointType.REGIONAL] },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      // X-Ray active tracing on the stage — traces every request end-to-end.
      deployOptions: { stageName: props.stage, tracingEnabled: true },
    });

    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      authorizerName: `${props.resourcePrefix}-cognito-authorizer`,
      cognitoUserPools: [props.userPool],
    });

    const cognitoMethodOptions: apigateway.MethodOptions = {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // GET /random-number (Cognito-authorized) — direct REST entry to the same
    // tool Lambda the AgentCore Gateway calls.
    const randomNumber = api.root.addResource('random-number');
    randomNumber.addMethod(
      'GET',
      new apigateway.LambdaIntegration(props.randomNumberFunction),
      cognitoMethodOptions
    );

    // POST /web-search (Cognito-authorized) — direct REST entry to the same tool
    // Lambda the AgentCore Gateway calls. Body: { query, llm_eval? }.
    api.root
      .addResource('web-search')
      .addMethod(
        'POST',
        new apigateway.LambdaIntegration(props.webSearchFunction),
        cognitoMethodOptions
      );

    // POST /web-retrieve (Cognito-authorized) — direct REST entry to the same tool
    // Lambda the AgentCore Gateway calls. Body: { url }.
    api.root
      .addResource('web-retrieve')
      .addMethod(
        'POST',
        new apigateway.LambdaIntegration(props.webRetrieveFunction),
        cognitoMethodOptions
      );

    // POST /users/signup (public)
    const users = api.root.addResource('users');
    const signup = users.addResource('signup');
    signup.addMethod('POST', new apigateway.LambdaIntegration(props.selfSignupFunction));

    // /temp-data/* (Cognito-authorized) — presigned-URL API for the temp bucket.
    const tempData = api.root.addResource('temp-data');
    tempData
      .addResource('upload-url')
      .addMethod(
        'POST',
        new apigateway.LambdaIntegration(props.uploadUrlFunction),
        cognitoMethodOptions
      );
    tempData
      .addResource('download-url')
      .addMethod(
        'GET',
        new apigateway.LambdaIntegration(props.downloadUrlFunction),
        cognitoMethodOptions
      );

    // /datalake/* (Cognito-authorized) — presigned-URL API for the medallion
    // lake. Uploads always land under the caller's own bronze prefix; downloads
    // are refused for any key outside it.
    const datalake = api.root.addResource('datalake');
    datalake
      .addResource('upload-url')
      .addMethod(
        'POST',
        new apigateway.LambdaIntegration(props.datalakeUploadUrlFunction),
        cognitoMethodOptions
      );
    datalake
      .addResource('download-url')
      .addMethod(
        'GET',
        new apigateway.LambdaIntegration(props.datalakeDownloadUrlFunction),
        cognitoMethodOptions
      );

    // /admin/users (Cognito-authorized) — admin user-management CRUD. Handlers
    // self-enforce the Admins group; the authorizer is the infra half.
    const adminUsers = api.root.addResource('admin').addResource('users');
    adminUsers.addMethod(
      'GET',
      new apigateway.LambdaIntegration(props.listUsersFunction),
      cognitoMethodOptions
    );
    adminUsers.addMethod(
      'POST',
      new apigateway.LambdaIntegration(props.createUserFunction),
      cognitoMethodOptions
    );
    adminUsers.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(props.updateUserFunction),
      cognitoMethodOptions
    );
    adminUsers.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(props.deleteUserFunction),
      cognitoMethodOptions
    );

    // /profile/claude-token (Cognito-authorized) — the caller's own Claude
    // subscription token. The handlers key the shared secret off the verified
    // email claim, so a user can only ever read or write their own entry.
    const claudeToken = api.root.addResource('profile').addResource('claude-token');
    claudeToken.addMethod(
      'GET',
      new apigateway.LambdaIntegration(props.getClaudeTokenFunction),
      cognitoMethodOptions
    );
    claudeToken.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(props.putClaudeTokenFunction),
      cognitoMethodOptions
    );

    // /converter/* (Cognito-authorized) — async markdown-conversion job API.
    // POST convert enqueues a job (202 + jobId); GET status polls the job row.
    const converter = api.root.addResource('converter');
    converter
      .addResource('convert')
      .addMethod(
        'POST',
        new apigateway.LambdaIntegration(props.triggerConversionFunction),
        cognitoMethodOptions
      );
    converter
      .addResource('status')
      .addMethod(
        'GET',
        new apigateway.LambdaIntegration(props.getConversionStatusFunction),
        cognitoMethodOptions
      );

    // /ontology/* (Cognito-authorized) — async ontology-build job API. POST build
    // hands the build to the agent runtime (202 + jobId); GET status polls the row;
    // GET builds lists the caller's saved ontologies and GET builds/{jobId}/outputs
    // presigns one build's gold artifacts. Every handler checks ownership.
    const ontology = api.root.addResource('ontology');
    ontology
      .addResource('build')
      .addMethod(
        'POST',
        new apigateway.LambdaIntegration(props.ontologyStartFunction),
        cognitoMethodOptions
      );
    ontology
      .addResource('status')
      .addMethod(
        'GET',
        new apigateway.LambdaIntegration(props.ontologyStatusFunction),
        cognitoMethodOptions
      );
    const builds = ontology.addResource('builds');
    builds.addMethod(
      'GET',
      new apigateway.LambdaIntegration(props.ontologyListFunction),
      cognitoMethodOptions
    );
    const buildById = builds.addResource('{jobId}');
    // Answers 202: the Lambda marks the row and hands the teardown to a worker,
    // because a large build is far more objects than a 29 second request allows.
    buildById.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(props.ontologyDeleteFunction),
      cognitoMethodOptions
    );
    // Adds or removes documents by deriving a NEW build from this one, so it answers
    // 202 with the new jobId and leaves the source ontology untouched. Its own child
    // resource rather than another method on {jobId}, because it creates rather than
    // acting on the build named in the path.
    buildById
      .addResource('corpus')
      .addMethod(
        'POST',
        new apigateway.LambdaIntegration(props.ontologyUpdateFunction),
        cognitoMethodOptions
      );
    // Completing a build that stopped short is the same derivation with the corpus
    // held fixed, so it is the same Lambda: the carry-forward stage retries only what
    // has no markdown and the extraction plan fans out only pages with no elements.
    buildById
      .addResource('redrive')
      .addMethod(
        'POST',
        new apigateway.LambdaIntegration(props.ontologyUpdateFunction),
        cognitoMethodOptions
      );
    // Sharing an ontology with every other user, and taking it back. The method is
    // the verb because the resource is the build's visibility, not a thing that is
    // created: POST publishes, DELETE makes it private again. Nothing is copied
    // either way, so both are one write to one row.
    const buildPublish = buildById.addResource('publish');
    buildPublish.addMethod(
      'POST',
      new apigateway.LambdaIntegration(props.ontologyPublishFunction),
      cognitoMethodOptions
    );
    buildPublish.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(props.ontologyPublishFunction),
      cognitoMethodOptions
    );
    // Answers the conversion review a build stops at when it loses documents. The only
    // ontology route that acts on a run in flight: it sends the task token the paused
    // execution is holding, with continue, stop, or a set of documents to convert again.
    buildById
      .addResource('review')
      .addMethod(
        'POST',
        new apigateway.LambdaIntegration(props.ontologyReviewFunction),
        cognitoMethodOptions
      );
    buildById
      .addResource('outputs')
      .addMethod(
        'GET',
        new apigateway.LambdaIntegration(props.ontologyOutputsFunction),
        cognitoMethodOptions
      );

    // Past conversations about one ontology. Nested under the build because the
    // build is the scope: the agent stores events under a composite
    // "{sub}/{buildId}" actor, so a foreign jobId returns an empty list rather
    // than another user's sessions.
    const buildConversations = buildById.addResource('conversations');
    buildConversations.addMethod(
      'GET',
      new apigateway.LambdaIntegration(props.listOntologyConversationsFunction),
      cognitoMethodOptions
    );
    buildConversations
      .addResource('{sessionId}')
      .addMethod(
        'GET',
        new apigateway.LambdaIntegration(props.getOntologyConversationFunction),
        cognitoMethodOptions
      );

    // /conversations (Cognito-authorized) — read-only proxies over the chat
    // AgentCore Memory. GET lists the caller's sessions; GET /{sessionId} replays
    // one. The handlers derive the actor from the JWT, so a user sees only their
    // own conversations.
    const conversations = api.root.addResource('conversations');
    conversations.addMethod(
      'GET',
      new apigateway.LambdaIntegration(props.listConversationsFunction),
      cognitoMethodOptions
    );
    conversations
      .addResource('{sessionId}')
      .addMethod(
        'GET',
        new apigateway.LambdaIntegration(props.getConversationFunction),
        cognitoMethodOptions
      );

    // CORS headers on authorizer / error responses (pre-integration)
    api.addGatewayResponse('Unauthorized', {
      type: apigateway.ResponseType.UNAUTHORIZED,
      statusCode: '401',
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    api.addGatewayResponse('Default4xx', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
      },
    });

    api.addGatewayResponse('Default5xx', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
      },
    });

    // No trailing slash (api.url has one) — the SPA joins `${VITE_API_URL}/hello`,
    // and a double slash 403s on API Gateway. Matches Terraform's invoke_url.
    this.apiEndpoint = `https://${api.restApiId}.execute-api.${cdk.Stack.of(this).region}.${
      cdk.Stack.of(this).urlSuffix
    }/${api.deploymentStage.stageName}`;
  }
}
