import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import ReactWebApp from './constructs/ui/ReactWebApp';

interface UiStackProps extends cdk.StackProps {
  resourcePrefix: string;
  domainName: string;
  certificateArn: string;
}

export class UiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: UiStackProps) {
    super(scope, id, props);

    const reactWebApp = new ReactWebApp(this, 'ReactWebApp', {
      resourcePrefix: props.resourcePrefix,
      domainName: props.domainName,
      certificateArn: props.certificateArn,
    });

    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: `https://${reactWebApp.distribution.attrDomainName}`,
      description: 'CloudFront Distribution URL',
    });
  }
}
