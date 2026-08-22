import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface ApiKeysProps {
  resourcePrefix: string;
}

// Secrets Manager secret holding third-party API keys (Mistral for the
// markdown-converter worker, Brave for the web_search tool). Seeded with EMPTY
// placeholder values — set the real keys AFTER deploy, e.g.:
//   aws secretsmanager put-secret-value \
//     --secret-id <resourcePrefix>-apikeys-secret \
//     --secret-string '{"MISTRAL_API_KEY":"...","BRAVE_API_KEY":"..."}'
export class ApiKeys extends Construct {
  public readonly secret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: ApiKeysProps) {
    super(scope, id);

    this.secret = new secretsmanager.Secret(this, 'ApiKeysSecret', {
      secretName: `${props.resourcePrefix}-apikeys-secret`,
      description:
        'Third-party API keys (Mistral, Brave) for the converter worker and web_search tool',
      secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify({ MISTRAL_API_KEY: '', BRAVE_API_KEY: '' })
      ),
    });
  }
}
