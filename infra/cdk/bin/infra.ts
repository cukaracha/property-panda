#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { getAppConfig } from '../lib/config';
import { CoreStack } from '../lib/core-stack';
import { DataStack } from '../lib/data-stack';
import { AiStack } from '../lib/ai-stack';
import { ApiStack } from '../lib/api-stack';
import { UiStack } from '../lib/ui-stack';

const app = new cdk.App();
const config = getAppConfig();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: config.region || process.env.CDK_DEFAULT_REGION,
};

// Core: authentication, shared Lambda layers, user-management Lambdas
const coreStack = new CoreStack(app, config.coreStackName, {
  env,
  resourcePrefix: config.resourcePrefix,
  approvedEmailDomains: config.approvedEmailDomains,
  seedDemoUsers: config.seedDemoUsers,
  federatedIdp: config.federatedIdp,
  allowedOrigins: config.allowedOrigins,
});

// Data: KB source-document bucket + browser-facing user-data / temp buckets
const dataStack = new DataStack(app, config.dataStackName, {
  env,
  resourcePrefix: config.resourcePrefix,
  allowedOrigins: config.allowedOrigins,
});

// AI: knowledge base + tool Lambdas, MCP gateway, AgentCore runtimes.
// The aws_utils layer is read from SSM inside the stack (published by Core),
// so the explicit addDependency(coreStack) below is what guarantees ordering.
const aiStack = new AiStack(app, config.aiStackName, {
  env,
  resourcePrefix: config.resourcePrefix,
  userPool: coreStack.cognito.userPool,
  userPoolClient: coreStack.cognito.userPoolClient,
  gatewayM2mClient: coreStack.cognito.gatewayM2mClient,
  gatewayScope: coreStack.cognito.gatewayScope,
  kbDataBucket: dataStack.kbDataBucket,
  tempBucket: dataStack.tempBucket,
  bronzeBucket: dataStack.bronzeBucket,
  silverBucket: dataStack.silverBucket,
  goldBucket: dataStack.goldBucket,
  claudeTokensSecret: coreStack.claudeTokens.secret,
});
aiStack.addDependency(coreStack);
aiStack.addDependency(dataStack);

// API: REST front door
const apiStack = new ApiStack(app, config.apiStackName, {
  env,
  stage: config.stage,
  resourcePrefix: config.resourcePrefix,
  userPool: coreStack.cognito.userPool,
  selfSignupFunction: coreStack.userManagement.selfSignupFunction,
  randomNumberFunction: aiStack.randomNumberFunction,
  webSearchFunction: aiStack.webSearchFunction,
  webRetrieveFunction: aiStack.webRetrieveFunction,
  ontologyStartFunction: aiStack.ontologyStartFunction,
  ontologyStatusFunction: aiStack.ontologyStatusFunction,
  ontologyListFunction: aiStack.ontologyListFunction,
  ontologyOutputsFunction: aiStack.ontologyOutputsFunction,
  ontologyJobTable: aiStack.ontologyJobTable,
  ontologyConvertStateMachineArn: aiStack.ontologyConvertStateMachineArn,
  ontologyConvertStateMachine: aiStack.ontologyConvertStateMachine,
  claudeTokensSecret: coreStack.claudeTokens.secret,
  ontologyVectorBucketArn: aiStack.ontologyVectorBucketArn,
  ontologyVectorBucketName: aiStack.ontologyVectorBucketName,
  ontologyVectorIndexArn: aiStack.ontologyVectorIndexArn,
  ontologyVectorIndexName: aiStack.ontologyVectorIndexName,
  chatMemoryId: aiStack.chatMemoryId,
  chatMemoryArn: aiStack.chatMemoryArn,
  ontologyChatMemoryId: aiStack.ontologyChatMemoryId,
  ontologyChatMemoryArn: aiStack.ontologyChatMemoryArn,
  tempBucket: dataStack.tempBucket,
  bronzeBucket: dataStack.bronzeBucket,
  silverBucket: dataStack.silverBucket,
  goldBucket: dataStack.goldBucket,
  apiKeysSecret: aiStack.apiKeysSecret,
  listUsersFunction: coreStack.userManagement.listUsersFunction,
  createUserFunction: coreStack.userManagement.createUserFunction,
  updateUserFunction: coreStack.userManagement.updateUserFunction,
  deleteUserFunction: coreStack.userManagement.deleteUserFunction,
  getClaudeTokenFunction: coreStack.userManagement.getClaudeTokenFunction,
  putClaudeTokenFunction: coreStack.userManagement.putClaudeTokenFunction,
});
apiStack.addDependency(coreStack);
apiStack.addDependency(dataStack);
apiStack.addDependency(aiStack);

// UI: frontend hosting. The chat runtime ARN and API URL reach the SPA build
// via deploy.sh -> apps/ui/web/.env.production, not as CFN references.
const uiStack = new UiStack(app, config.uiStackName, {
  env,
  resourcePrefix: config.resourcePrefix,
  domainName: config.domainName,
  certificateArn: config.certificateArn,
});
uiStack.addDependency(coreStack);
uiStack.addDependency(apiStack);
