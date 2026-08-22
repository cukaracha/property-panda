import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

// Cognito OIDC provider name for the optional federated IdP. This literal is a
// shared contract — it must stay identical in Terraform (backend_auth.tf) and
// the frontend (config/app.ts SSO_PROVIDER) which passes it to signInWithRedirect.
const FEDERATED_IDP_PROVIDER_NAME = 'FederatedIdP';

export interface CognitoProps {
  resourcePrefix: string;
  // When true, seed a demo admin + demo user into the pool (dev sample only).
  // Off by default so a normal deploy seeds nothing. Sourced from AppConfig.json.
  seedDemoUsers?: boolean;
  // Optional OIDC federated identity provider. When set, an IdP is provisioned
  // and the app client gains the OAuth authorization-code flow with both COGNITO
  // and the federated provider (hybrid — password login is retained).
  federatedIdp?: { issuerUrl: string; clientId: string };
  // Browser origins used as OAuth callback/logout URLs (reuses allowedOrigins).
  oauthUrls?: string[];
}

export class Cognito extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly gatewayM2mClient: cognito.UserPoolClient;
  /** OAuth2 scope requested for the client-credentials grant ("gateway/invoke"). */
  public readonly gatewayScope: string;
  /** Hosted-UI base URL (https://...) — surfaced so the SPA can drive OAuth. */
  public readonly cognitoDomainBaseUrl: string;

  constructor(scope: Construct, id: string, props: CognitoProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    // Self-signup is disabled at the pool level. Accounts are created by the
    // self_signup Lambda via AdminCreateUser (which emails a temporary
    // password) and are always added to the Users group.
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${props.resourcePrefix}-user-pool`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // The L2 standardAttributes prop can't express length constraints, so set the
    // schema directly here (the single source of truth for it). Only the required
    // attributes are declared — given_name/family_name, matching Terraform's 1-256
    // bounds. The optional profile fields the profile page edits (phone_number,
    // birthdate, gender, address) stay as built-in standard attributes — mutable
    // and writable by default — so they need no entry here.
    const cfnUserPool = this.userPool.node.defaultChild as cognito.CfnUserPool;
    cfnUserPool.schema = [
      {
        name: 'given_name',
        attributeDataType: 'String',
        required: true,
        mutable: true,
        stringAttributeConstraints: { minLength: '1', maxLength: '256' },
      },
      {
        name: 'family_name',
        attributeDataType: 'String',
        required: true,
        mutable: true,
        stringAttributeConstraints: { minLength: '1', maxLength: '256' },
      },
    ];

    // Optional OIDC federated identity provider. The client secret is never in
    // config — a placeholder Secrets Manager secret is created here and the real
    // value is pasted via the Console after the IdP app is registered (see the
    // deploy sequence). unsafeUnwrap() emits a {{resolve:secretsmanager}} dynamic
    // reference that Cognito resolves live at deploy, so the plaintext never
    // enters the template.
    let federatedIdp: cognito.CfnUserPoolIdentityProvider | undefined;
    if (props.federatedIdp) {
      const idpSecret = new secretsmanager.Secret(this, 'FederatedIdpClientSecret', {
        secretName: `${props.resourcePrefix}-federated-idp-client-secret`,
        description:
          'OIDC federated IdP client secret. Update via AWS Console after IdP app registration, then redeploy.',
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      new cdk.CfnOutput(this, 'FederatedIdpClientSecretName', {
        value: idpSecret.secretName,
        description:
          'Secrets Manager secret holding the federated IdP client secret (update via Console)',
      });

      federatedIdp = new cognito.CfnUserPoolIdentityProvider(this, 'FederatedIdp', {
        userPoolId: this.userPool.userPoolId,
        providerName: FEDERATED_IDP_PROVIDER_NAME,
        providerType: 'OIDC',
        providerDetails: {
          client_id: props.federatedIdp.clientId,
          client_secret: idpSecret.secretValue.unsafeUnwrap(),
          attributes_request_method: 'GET',
          oidc_issuer: props.federatedIdp.issuerUrl,
          authorize_scopes: 'openid email profile',
        },
        attributeMapping: {
          email: 'email',
          given_name: 'given_name',
          family_name: 'family_name',
        },
      });
    }

    // Longer access/id token life (default is 60 min) gives the forwarded
    // Cognito token ample headroom for the multi-hop chat -> A2A subagent ->
    // MCP gateway chain, where each hop re-validates it and AgentCore rejects
    // tokens with <60s of life. Refresh token stays at the 30-day default.
    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: `${props.resourcePrefix}-app-client`,
      generateSecret: false,
      authFlows: { userSrp: true, userPassword: true },
      accessTokenValidity: cdk.Duration.hours(3),
      idTokenValidity: cdk.Duration.hours(3),
      preventUserExistenceErrors: true,
      // OAuth is added only when a federated IdP is configured, so the disabled
      // synth is byte-for-byte identical to today. HYBRID: COGNITO stays in the
      // provider list so the SRP/password path keeps working alongside SSO.
      ...(props.federatedIdp
        ? {
            oAuth: {
              flows: { authorizationCodeGrant: true },
              callbackUrls: props.oauthUrls,
              logoutUrls: props.oauthUrls,
              scopes: [
                cognito.OAuthScope.OPENID,
                cognito.OAuthScope.EMAIL,
                cognito.OAuthScope.PROFILE,
                cognito.OAuthScope.COGNITO_ADMIN,
              ],
            },
            supportedIdentityProviders: [
              cognito.UserPoolClientIdentityProvider.COGNITO,
              cognito.UserPoolClientIdentityProvider.custom(FEDERATED_IDP_PROVIDER_NAME),
            ],
          }
        : {}),
    });

    // The client references the IdP by name string — make the dependency explicit.
    if (federatedIdp) {
      this.userPoolClient.node.addDependency(federatedIdp);
    }

    // Machine-to-machine (client-credentials) auth for the MCP gateway. The
    // client-credentials grant needs a hosted-UI domain (token endpoint) and a
    // resource server, because Cognito mandates at least one custom scope on a
    // client-credentials request. The gateway authorizer only checks the client
    // id (not the scope), but the scope must still exist to mint the token.
    const domain = this.userPool.addDomain('Domain', {
      cognitoDomain: {
        // Globally unique across all AWS accounts.
        domainPrefix: `${props.resourcePrefix}-${stack.account}`,
      },
    });

    // Reuse this hosted-UI domain for the federated OAuth redirect (no second
    // domain). Surfaced via a CoreStack CfnOutput -> VITE_COGNITO_DOMAIN.
    this.cognitoDomainBaseUrl = domain.baseUrl();

    const invokeScope = new cognito.ResourceServerScope({
      scopeName: 'invoke',
      scopeDescription: 'Invoke the MCP gateway',
    });

    const resourceServer = this.userPool.addResourceServer('GatewayResourceServer', {
      identifier: 'gateway',
      userPoolResourceServerName: `${props.resourcePrefix}-gateway`,
      scopes: [invokeScope],
    });

    this.gatewayScope = 'gateway/invoke';

    // Secret client used only by AgentCore Identity's credential provider for
    // the OAuth2 client-credentials grant — never shipped to a browser.
    this.gatewayM2mClient = new cognito.UserPoolClient(this, 'GatewayM2mClient', {
      userPool: this.userPool,
      userPoolClientName: `${props.resourcePrefix}-gateway-m2m`,
      generateSecret: true,
      oAuth: {
        flows: { clientCredentials: true },
        scopes: [cognito.OAuthScope.resourceServer(resourceServer, invokeScope)],
      },
    });
    // The OAuth2 token endpoint is served off the hosted-UI domain.
    this.gatewayM2mClient.node.addDependency(domain);

    // Groups — new users go to Users; Admins is reserved for manual promotion
    const adminsGroup = new cognito.CfnUserPoolGroup(this, 'AdminsGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'Admins',
      description: 'Administrator group with full access',
      precedence: 1,
    });

    const usersGroup = new cognito.CfnUserPoolGroup(this, 'UsersGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'Users',
      description: 'Standard user group',
      precedence: 10,
    });

    // AppConfig-gated demo seeding — a demo admin + demo user for the dev sample.
    // Off by default (seedDemoUsers=false) so a normal deploy seeds nothing.
    if (props.seedDemoUsers) {
      const demoUsers = [
        { id: 'DemoUser', email: 'user@example.com', password: 'User@123', group: 'Users' },
        { id: 'DemoAdmin', email: 'admin@example.com', password: 'Admin@123', group: 'Admins' },
      ];

      for (const demo of demoUsers) {
        const cfnUser = new cognito.CfnUserPoolUser(this, demo.id, {
          userPoolId: this.userPool.userPoolId,
          username: demo.email,
          desiredDeliveryMediums: ['EMAIL'],
          forceAliasCreation: false,
          userAttributes: [
            { name: 'email', value: demo.email },
            { name: 'email_verified', value: 'true' },
            { name: 'given_name', value: demo.id.replace('Demo', '') },
            { name: 'family_name', value: 'Demo' },
          ],
        });

        // Set a permanent password so the demo account skips FORCE_CHANGE_PASSWORD.
        const setPassword = new cr.AwsCustomResource(this, `${demo.id}SetPassword`, {
          onCreate: {
            service: 'CognitoIdentityServiceProvider',
            action: 'adminSetUserPassword',
            parameters: {
              UserPoolId: this.userPool.userPoolId,
              Username: demo.email,
              Password: demo.password,
              Permanent: true,
            },
            physicalResourceId: cr.PhysicalResourceId.of(`${demo.id}SetPassword`),
          },
          policy: cr.AwsCustomResourcePolicy.fromStatements([
            new iam.PolicyStatement({
              actions: ['cognito-idp:AdminSetUserPassword'],
              resources: [this.userPool.userPoolArn],
            }),
          ]),
        });
        setPassword.node.addDependency(cfnUser);

        const groupAttachment = new cognito.CfnUserPoolUserToGroupAttachment(
          this,
          `${demo.id}GroupAttachment`,
          {
            userPoolId: this.userPool.userPoolId,
            username: demo.email,
            groupName: demo.group,
          }
        );
        groupAttachment.node.addDependency(cfnUser);
        groupAttachment.node.addDependency(demo.group === 'Admins' ? adminsGroup : usersGroup);
      }
    }
  }
}
