import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ClaudeTokens } from './constructs/core/ClaudeTokens';
import { Cognito } from './constructs/core/Cognito';
import { LambdaLayers } from './constructs/core/LambdaLayers';
import { UserManagement } from './constructs/core/UserManagement';

interface CoreStackProps extends cdk.StackProps {
  resourcePrefix: string;
  approvedEmailDomains: string[];
  seedDemoUsers: boolean;
  federatedIdp?: { issuerUrl: string; clientId: string };
  allowedOrigins: string[];
}

export class CoreStack extends cdk.Stack {
  public readonly cognito: Cognito;
  public readonly lambdaLayers: LambdaLayers;
  public readonly userManagement: UserManagement;
  public readonly claudeTokens: ClaudeTokens;

  constructor(scope: Construct, id: string, props: CoreStackProps) {
    super(scope, id, props);

    // Auth
    this.cognito = new Cognito(this, 'Cognito', {
      resourcePrefix: props.resourcePrefix,
      seedDemoUsers: props.seedDemoUsers,
      federatedIdp: props.federatedIdp,
      oauthUrls: props.allowedOrigins,
    });

    // Lambda layers — publishes the aws_utils layer ARN to SSM so consumer
    // stacks read it without a CloudFormation export lock.
    this.lambdaLayers = new LambdaLayers(this, 'LambdaLayers', {
      resourcePrefix: props.resourcePrefix,
    });

    // Per-user Claude subscription tokens — the ontology agent resolves the
    // caller's entry so every build runs on their own subscription.
    this.claudeTokens = new ClaudeTokens(this, 'ClaudeTokens', {
      resourcePrefix: props.resourcePrefix,
    });

    // User management
    this.userManagement = new UserManagement(this, 'UserManagement', {
      resourcePrefix: props.resourcePrefix,
      userPool: this.cognito.userPool,
      approvedEmailDomains: props.approvedEmailDomains,
      awsUtilsLayer: this.lambdaLayers.awsUtilsLayer,
      claudeTokensSecret: this.claudeTokens.secret,
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.cognito.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.cognito.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    // Hosted-UI base URL — deploy.sh strips the scheme and writes it as
    // VITE_COGNITO_DOMAIN so the SPA can drive the federated OAuth redirect.
    new cdk.CfnOutput(this, 'CognitoUserPoolDomainBaseUrl', {
      value: this.cognito.cognitoDomainBaseUrl,
      description: 'Cognito hosted-UI base URL (SPA OAuth redirect)',
    });
  }
}
