import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface ClaudeTokensProps {
  resourcePrefix: string;
}

// Secrets Manager secret holding the per-user Claude subscription tokens the
// ontology agent runs on. One secret carries a JSON map of
// {"<cognito email>": {"token": "sk-ant-oat...", "updatedAt": "<iso>"}}.
//
// A user writes their own key from the profile page (PUT /profile/claude-token);
// when they start an ontology build, the agent runtime resolves THEIR entry, so
// every run consumes the subscription of the person who started it.
//
// Seeded with an empty object — no token ever enters CloudFormation state. The
// profile Lambda is the only writer.
export class ClaudeTokens extends Construct {
  public readonly secret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: ClaudeTokensProps) {
    super(scope, id);

    this.secret = new secretsmanager.Secret(this, 'ClaudeTokensSecret', {
      secretName: `${props.resourcePrefix}-claude-user-tokens`,
      description:
        'JSON map of Cognito email -> Claude subscription OAuth token, written by the profile page',
      secretStringValue: cdk.SecretValue.unsafePlainText(JSON.stringify({})),
    });
  }
}
