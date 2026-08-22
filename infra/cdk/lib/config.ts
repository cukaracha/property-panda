import * as fs from 'fs';
import * as path from 'path';

export interface AppConfig {
  stage: string;
  appName: string;
  displayName: string;
  region: string;
  domainName: string;
  certificateArn: string;
  allowedOrigins: string[];
  approvedEmailDomains: string[];
  seedDemoUsers: boolean;
  // Optional OIDC federated identity provider. When set (both fields non-empty),
  // an IdP is provisioned in Cognito and a federated sign-in button appears on
  // the login page alongside email/password. Omit (or leave blank) to disable.
  federatedIdp?: { issuerUrl: string; clientId: string };
  resourcePrefix: string;
  coreStackName: string;
  dataStackName: string;
  apiStackName: string;
  aiStackName: string;
  uiStackName: string;
}

export const getAppConfig = (): AppConfig => {
  // Single source of truth shared with Terraform — lives at the repo root.
  const configPath = path.join(__dirname, '../../../AppConfig.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const appName = config.appName;
  const stage = config.stage || 'dev';
  const resourcePrefix = `${stage}-${appName}`.toLowerCase();
  // region is required — fail fast rather than silently defaulting, so the CDK
  // and Terraform trees can never drift to different regions.
  if (!config.region) {
    throw new Error('AppConfig.json must set a non-empty "region".');
  }
  return {
    stage,
    appName,
    displayName: config.displayName || appName,
    region: config.region,
    domainName: config.domainName || '',
    certificateArn: config.certificateArn || '',
    allowedOrigins: config.allowedOrigins || ['http://localhost:3000'],
    approvedEmailDomains: config.approvedEmailDomains || [],
    // Off by default — a normal deploy seeds no users. Set true in AppConfig.json
    // to seed the demo admin + demo user (dev sample only).
    seedDemoUsers: config.seedDemoUsers === true,
    // Enabled only when both fields are present and non-empty; otherwise
    // undefined so the disabled path is byte-for-byte identical to today.
    federatedIdp:
      config.federatedIdp?.issuerUrl && config.federatedIdp?.clientId
        ? {
            issuerUrl: config.federatedIdp.issuerUrl,
            clientId: config.federatedIdp.clientId,
          }
        : undefined,
    resourcePrefix,
    coreStackName: `${stage}-${appName}-CoreStack`,
    dataStackName: `${stage}-${appName}-DataStack`,
    apiStackName: `${stage}-${appName}-ApiStack`,
    aiStackName: `${stage}-${appName}-AiStack`,
    uiStackName: `${stage}-${appName}-UiStack`,
  };
};
