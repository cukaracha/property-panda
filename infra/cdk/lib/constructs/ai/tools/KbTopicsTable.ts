import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface KbTopicsTableProps {
  resourcePrefix: string;
}

// topicId -> Bedrock dataSourceId mapping used by the course_knowledge_base
// tool to scope Retrieve calls to a single topic's data source.
export class KbTopicsTable extends Construct {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: KbTopicsTableProps) {
    super(scope, id);

    this.table = new dynamodb.Table(this, 'Table', {
      tableName: `${props.resourcePrefix}-kb-topics`,
      partitionKey: { name: 'topicId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }
}
