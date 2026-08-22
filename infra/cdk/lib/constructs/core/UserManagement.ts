import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as path from 'path';
import { Construct } from 'constructs';

export interface UserManagementProps {
  resourcePrefix: string;
  userPool: cognito.IUserPool;
  approvedEmailDomains: string[];
  awsUtilsLayer: lambda.ILayerVersion;
  claudeTokensSecret: secretsmanager.ISecret;
}

export class UserManagement extends Construct {
  public readonly selfSignupFunction: lambda.Function;
  public readonly listUsersFunction: lambda.Function;
  public readonly createUserFunction: lambda.Function;
  public readonly updateUserFunction: lambda.Function;
  public readonly deleteUserFunction: lambda.Function;
  public readonly getClaudeTokenFunction: lambda.Function;
  public readonly putClaudeTokenFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: UserManagementProps) {
    super(scope, id);

    const baseLambdaPath = path.join(__dirname, '../../../../../apps/apis/user_management');

    // self_signup — creates a Cognito user + adds to the Users group. First
    // login returns a NEW_PASSWORD_REQUIRED challenge where the user sets a
    // permanent password + first/last name.
    this.selfSignupFunction = new lambda.Function(this, 'SelfSignupFunction', {
      functionName: `${props.resourcePrefix}-self-signup`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'self_signup.lambda_handler',
      code: lambda.Code.fromAsset(path.join(baseLambdaPath, 'create')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      layers: [props.awsUtilsLayer],
      environment: {
        USER_POOL_ID: props.userPool.userPoolId,
        // New users always land in the standard Users group, never Admins.
        USER_GROUP: 'Users',
        APPROVED_DOMAINS: JSON.stringify(props.approvedEmailDomains),
      },
      logGroup: new logs.LogGroup(this, 'SelfSignupLogGroup', {
        logGroupName: `/aws/lambda/${props.resourcePrefix}-self-signup`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    this.selfSignupFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminCreateUser', 'cognito-idp:AdminAddUserToGroup'],
        resources: [props.userPool.userPoolArn],
      })
    );

    // Admin user-management functions — all Cognito-authorized at the API layer
    // and self-enforcing the Admins group in the handler. Each is granted only
    // the Cognito admin actions it needs, scoped to this pool's ARN.
    const adminFn = (
      id: string,
      purpose: string,
      handler: string,
      verbDir: string,
      actions: string[]
    ): lambda.Function => {
      const fn = new lambda.Function(this, id, {
        functionName: `${props.resourcePrefix}-${purpose}`,
        runtime: lambda.Runtime.PYTHON_3_12,
        handler,
        code: lambda.Code.fromAsset(path.join(baseLambdaPath, verbDir)),
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
        layers: [props.awsUtilsLayer],
        environment: {
          USER_POOL_ID: props.userPool.userPoolId,
        },
        logGroup: new logs.LogGroup(this, `${id}LogGroup`, {
          logGroupName: `/aws/lambda/${props.resourcePrefix}-${purpose}`,
          retention: logs.RetentionDays.TWO_WEEKS,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      });

      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions,
          resources: [props.userPool.userPoolArn],
        })
      );

      return fn;
    };

    this.listUsersFunction = adminFn(
      'ListUsersFunction',
      'list-users',
      'list_users.lambda_handler',
      'read',
      [
        'cognito-idp:ListUsers',
        'cognito-idp:ListUsersInGroup',
        'cognito-idp:AdminListGroupsForUser',
      ]
    );

    this.createUserFunction = adminFn(
      'CreateUserFunction',
      'create-user',
      'create_user.lambda_handler',
      'create',
      ['cognito-idp:AdminCreateUser', 'cognito-idp:AdminAddUserToGroup']
    );

    this.updateUserFunction = adminFn(
      'UpdateUserFunction',
      'update-user',
      'update_user.lambda_handler',
      'update',
      [
        'cognito-idp:AdminUpdateUserAttributes',
        'cognito-idp:AdminListGroupsForUser',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminRemoveUserFromGroup',
      ]
    );

    this.deleteUserFunction = adminFn(
      'DeleteUserFunction',
      'delete-user',
      'delete_user.lambda_handler',
      'delete',
      ['cognito-idp:AdminDeleteUser']
    );

    // /profile/claude-token — the signed-in user's own Claude subscription
    // token, keyed in the shared secret by their verified email claim. GET
    // reports status only (never the token); PUT merges or removes their key.
    const profileFn = (
      id: string,
      purpose: string,
      handler: string,
      verbDir: string
    ): lambda.Function =>
      new lambda.Function(this, id, {
        functionName: `${props.resourcePrefix}-${purpose}`,
        runtime: lambda.Runtime.PYTHON_3_12,
        handler,
        code: lambda.Code.fromAsset(path.join(baseLambdaPath, verbDir)),
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
        layers: [props.awsUtilsLayer],
        environment: {
          CLAUDE_TOKENS_SECRET: props.claudeTokensSecret.secretArn,
        },
        logGroup: new logs.LogGroup(this, `${id}LogGroup`, {
          logGroupName: `/aws/lambda/${props.resourcePrefix}-${purpose}`,
          retention: logs.RetentionDays.TWO_WEEKS,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      });

    this.getClaudeTokenFunction = profileFn(
      'GetClaudeTokenFunction',
      'get-claude-token',
      'get_claude_token.lambda_handler',
      'read'
    );
    props.claudeTokensSecret.grantRead(this.getClaudeTokenFunction);

    this.putClaudeTokenFunction = profileFn(
      'PutClaudeTokenFunction',
      'put-claude-token',
      'put_claude_token.lambda_handler',
      'update'
    );
    props.claudeTokensSecret.grantRead(this.putClaudeTokenFunction);
    props.claudeTokensSecret.grantWrite(this.putClaudeTokenFunction);

    // grantWrite covers PutSecretValue; the compare-and-swap also moves the
    // version stage, which has no grant helper.
    this.putClaudeTokenFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:UpdateSecretVersionStage'],
        resources: [props.claudeTokensSecret.secretArn],
      })
    );
  }
}
