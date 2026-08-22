import * as cdk from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export interface McpGatewayProps {
  resourcePrefix: string;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  gatewayM2mClient: cognito.IUserPoolClient;
  randomNumberFunction: lambda.IFunction;
  kbToolFunction: lambda.IFunction;
  webSearchFunction: lambda.IFunction;
  webRetrieveFunction: lambda.IFunction;
}

// AgentCore Gateway that exposes the tool Lambdas to the agents over MCP
// (streamable HTTP), plus the AgentCore Identity OAuth2 credential provider
// the agents use to mint their OWN gateway token (M2M) — no user-token replay.
export class McpGateway extends Construct {
  public readonly gatewayUrl: string;
  public readonly gatewayArn: string;
  /** Name the agents pass to @requires_access_token (GATEWAY_CREDENTIAL_PROVIDER). */
  public readonly credentialProviderName: string;

  constructor(scope: Construct, id: string, props: McpGatewayProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    // Gateway — MCP protocol, Cognito JWT inbound auth. Two allowed clients:
    //   - the app client: kept so the user token still validates during
    //     rollout / any direct calls.
    //   - the M2M client: the agents' OWN client-credentials token, vended by
    //     AgentCore Identity. This is the real production path.
    // Gateway names allow letters/digits/hyphens — NOT underscores.
    const gateway = new agentcore.Gateway(this, 'Gateway', {
      gatewayName: `${props.resourcePrefix}-chat-gateway`,
      authorizerConfiguration: agentcore.GatewayAuthorizer.usingCognito({
        userPool: props.userPool,
        allowedClients: [props.userPoolClient, props.gatewayM2mClient],
      }),
    });

    // Drop ProtocolConfiguration entirely (Terraform parity — service defaults
    // apply). The L2 always injects one (semantic search tool + pinned
    // versions), and an explicit empty {} is rejected: "MCP configuration
    // cannot be empty". The property is optional in CloudFormation.
    const cfnGateway = gateway.node.defaultChild as agentcore.CfnGateway;
    cfnGateway.addPropertyDeletionOverride('ProtocolConfiguration');

    this.gatewayUrl = gateway.gatewayUrl ?? '';
    this.gatewayArn = gateway.gatewayArn;

    // AgentCore Identity OAuth2 credential provider — a custom OAuth2
    // client-credentials grant against the same Cognito pool, using the secret
    // M2M client. The client secret is fetched in-stack via
    // DescribeUserPoolClient so it never becomes a cross-stack CloudFormation
    // export; AgentCore vaults it in its own token vault.
    const clientSecretFetcher = new cr.AwsCustomResource(this, 'M2mClientSecret', {
      onCreate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'describeUserPoolClient',
        parameters: {
          UserPoolId: props.userPool.userPoolId,
          ClientId: props.gatewayM2mClient.userPoolClientId,
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${props.resourcePrefix}-gateway-m2m-secret`),
      },
      onUpdate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'describeUserPoolClient',
        parameters: {
          UserPoolId: props.userPool.userPoolId,
          ClientId: props.gatewayM2mClient.userPoolClientId,
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${props.resourcePrefix}-gateway-m2m-secret`),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['cognito-idp:DescribeUserPoolClient'],
          resources: [props.userPool.userPoolArn],
        }),
      ]),
    });

    // Credential provider names allow underscores only — no hyphens.
    this.credentialProviderName = `${props.resourcePrefix.replace(/-/g, '_')}_gateway_m2m`;

    // The Cognito OIDC discovery doc's token_endpoint resolves to the
    // hosted-UI domain created in the Core stack.
    agentcore.OAuth2CredentialProvider.usingCustom(this, 'GatewayM2mProvider', {
      oAuth2CredentialProviderName: this.credentialProviderName,
      clientId: props.gatewayM2mClient.userPoolClientId,
      clientSecret: cdk.SecretValue.resourceAttribute(
        clientSecretFetcher.getResponseField('UserPoolClient.ClientSecret')
      ),
      discoveryUrl: `https://cognito-idp.${stack.region}.amazonaws.com/${props.userPool.userPoolId}/.well-known/openid-configuration`,
    });

    // Resource-based permission so the gateway service can invoke each tool —
    // belt-and-suspenders alongside the L2's identity-based grant. Created
    // BEFORE the targets: AgentCore validates invoke permission at
    // target-create time.
    props.randomNumberFunction.addPermission('AllowAgentCoreGatewayInvokeRandomNumber', {
      principal: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: gateway.gatewayArn,
      sourceAccount: stack.account,
    });

    props.kbToolFunction.addPermission('AllowAgentCoreGatewayInvokeKb', {
      principal: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: gateway.gatewayArn,
      sourceAccount: stack.account,
    });

    props.webSearchFunction.addPermission('AllowAgentCoreGatewayInvokeWebSearch', {
      principal: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: gateway.gatewayArn,
      sourceAccount: stack.account,
    });

    props.webRetrieveFunction.addPermission('AllowAgentCoreGatewayInvokeWebRetrieve', {
      principal: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: gateway.gatewayArn,
      sourceAccount: stack.account,
    });

    // Gateway target — registers the random_number Lambda as an MCP tool. The
    // gateway invokes the Lambda using its own IAM role (the L2 grants invoke
    // on the gateway role via grantInvoke).
    const toolsTarget = agentcore.GatewayTarget.forLambda(this, 'ToolsTarget', {
      gateway,
      gatewayTargetName: 'tools',
      lambdaFunction: props.randomNumberFunction,
      toolSchema: agentcore.ToolSchema.fromInline([
        {
          name: 'generate_random_number',
          description: 'Generate a random integer between 1 and 100. Takes no input.',
          // No params — the tool takes no caller input.
          inputSchema: { type: agentcore.SchemaDefinitionType.OBJECT },
        },
      ]),
      credentialProviderConfigurations: [agentcore.GatewayCredentialProvider.fromIamRole()],
    });

    // Gateway target — registers the kb Lambda as the course_knowledge_base tool.
    const kbTarget = agentcore.GatewayTarget.forLambda(this, 'KbTarget', {
      gateway,
      gatewayTargetName: 'kb',
      lambdaFunction: props.kbToolFunction,
      toolSchema: agentcore.ToolSchema.fromInline([
        {
          name: 'course_knowledge_base',
          description:
            "Search a topic's knowledge base (lesson materials) and return the most relevant passages. Requires the topic id.",
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              topicId: {
                type: agentcore.SchemaDefinitionType.STRING,
                description: 'The topic id to search (e.g. phys2001).',
              },
              query: {
                type: agentcore.SchemaDefinitionType.STRING,
                description: 'The search query / student question.',
              },
              topK: {
                type: agentcore.SchemaDefinitionType.NUMBER,
                description: 'Optional number of passages to return (1-100, default 10).',
              },
            },
            required: ['topicId', 'query'],
          },
        },
      ]),
      credentialProviderConfigurations: [agentcore.GatewayCredentialProvider.fromIamRole()],
    });

    // Gateway target — registers the web_search Lambda as the web_search tool.
    const webSearchTarget = agentcore.GatewayTarget.forLambda(this, 'WebSearchTarget', {
      gateway,
      gatewayTargetName: 'websearch',
      lambdaFunction: props.webSearchFunction,
      toolSchema: agentcore.ToolSchema.fromInline([
        {
          name: 'web_search',
          description:
            'Search the web (Brave) and return candidate results (title, url, snippet) — metadata only, no page bodies. Set llm_eval=true to have the tool LLM-filter candidates down to the relevant ones (each with a why_relevant); default returns all candidates for the caller to judge. Pair with web_retrieve to read the chosen URLs.',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              query: {
                type: agentcore.SchemaDefinitionType.STRING,
                description: 'The search query (e.g. "ACME Corp data breach 2024").',
              },
              llm_eval: {
                type: agentcore.SchemaDefinitionType.BOOLEAN,
                description:
                  'Optional. When true, the tool LLM-filters candidates to only the relevant ones (each with a why_relevant). Defaults to false (return all candidates).',
              },
            },
            required: ['query'],
          },
        },
      ]),
      credentialProviderConfigurations: [agentcore.GatewayCredentialProvider.fromIamRole()],
    });

    // Gateway target — registers the web_retrieve Lambda as the web_retrieve tool.
    const webRetrieveTarget = agentcore.GatewayTarget.forLambda(this, 'WebRetrieveTarget', {
      gateway,
      gatewayTargetName: 'webretrieve',
      lambdaFunction: props.webRetrieveFunction,
      toolSchema: agentcore.ToolSchema.fromInline([
        {
          name: 'web_retrieve',
          description:
            'Fetch one URL and return its full clean reader-ready markdown, rendered with a real headless browser (Crawl4AI, JavaScript executed, boilerplate stripped). Call once per URL; pair with web_search to find URLs worth reading.',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              url: {
                type: agentcore.SchemaDefinitionType.STRING,
                description:
                  'The full http(s) URL of the page to fetch (e.g. https://example.com/article).',
              },
            },
            required: ['url'],
          },
        },
      ]),
      credentialProviderConfigurations: [agentcore.GatewayCredentialProvider.fromIamRole()],
    });

    // TODO(mcp): register the ontology tool targets here when MCP is enabled.
    // The ontology control Lambdas (start_ontology_build / get_ontology_build_status)
    // already live in the Ai stack and are exposed as ontologyStartFunction /
    // ontologyStatusFunction, so enabling MCP is purely additive:
    //   1. thread them in as props (McpGatewayProps),
    //   2. add an fn.addPermission('AllowAgentCoreGatewayInvokeOntology*', ...) for each,
    //   3. add a GatewayTarget.forLambda(this, 'OntologyStartTarget'/'OntologyStatusTarget',
    //      { gateway, gatewayTargetName, lambdaFunction, toolSchema: ToolSchema.fromInline([...]),
    //        credentialProviderConfigurations: [GatewayCredentialProvider.fromIamRole()] }),
    //   4. add each target to the ordering loop below.
    // No control-Lambda code change is needed — the handlers keep a commented
    // is_gateway_invocation branch ready to activate.

    // AgentCore validates the gateway role's invoke permission when the target
    // is created, but the L2 discards the Grant from its internal
    // grantInvoke(gateway.role) — no DependsOn edge orders the role's default
    // policy (or the Lambda permissions above) before the targets. Sequence
    // them explicitly, mirroring Terraform's depends_on. Depending on the role
    // construct covers its DefaultPolicy child.
    const toolFunctions = [
      props.randomNumberFunction,
      props.kbToolFunction,
      props.webSearchFunction,
      props.webRetrieveFunction,
    ];
    const permissionIds = [
      'AllowAgentCoreGatewayInvokeRandomNumber',
      'AllowAgentCoreGatewayInvokeKb',
      'AllowAgentCoreGatewayInvokeWebSearch',
      'AllowAgentCoreGatewayInvokeWebRetrieve',
    ];
    for (const target of [toolsTarget, kbTarget, webSearchTarget, webRetrieveTarget]) {
      target.node.addDependency(gateway.role);
      for (const fn of toolFunctions) {
        for (const permissionId of permissionIds) {
          const permission = fn.node.tryFindChild(permissionId);
          if (permission) {
            target.node.addDependency(permission);
          }
        }
      }
    }
  }
}
