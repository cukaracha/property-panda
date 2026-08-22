import * as cdk from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as fs from 'fs';
import * as path from 'path';
import { Construct } from 'constructs';

export interface OntologyAgentProps {
  resourcePrefix: string;
  bronzeBucket: s3.IBucket;
  silverBucket: s3.IBucket;
  goldBucket: s3.IBucket;
  claudeTokensSecret: secretsmanager.ISecret;
  awsUtilsLayer: lambda.ILayerVersion;
  vectorBucketArn: string;
  vectorBucketName: string;
  vectorIndexArn: string;
  vectorIndexName: string;
}

// The ontology build: a Step Functions state machine that owns every deterministic
// stage, calling out to a Claude Agent SDK runtime on AgentCore for the two stages
// that need a model.
//
// The state machine converts each document, segments the markdown into pages, fans
// EXTRACT out one Distributed Map branch per batch of pages, compacts the result,
// hands CONSOLIDATE to the runtime, then canonicalizes and emits in Lambdas — all
// while the page index hydrates on a second branch. Every fan-out is DISTRIBUTED so a
// branch's polling stays in a child execution rather than in the parent's 25,000-event
// history, which is what makes a corpus of hundreds of documents survivable.
//
// EXTRACT is the whole reason this shape exists: it is one model call per page and it
// is embarrassingly parallel, so its concurrency belongs to infrastructure rather than
// to a model asked politely to dispatch batches in parallel. CANONICALIZE and EMIT
// make no model calls at all and are plain Lambdas. That leaves CONSOLIDATE as the
// only stage a model decides anything in.
//
// The runtime is a CONTAINER, not a zip — claude-agent-sdk shells out to a ~244 MB
// `claude` CLI the image has to carry, which the zip ceiling cannot hold. It is the
// first container runtime this repo deploys.
//
// Text generation runs on the CALLER'S Claude subscription, resolved per email from
// the shared tokens secret, so this role holds no general Bedrock text-model access.
// The one Bedrock grant is InvokeModel pinned to the Titan embedding model, because
// Anthropic has no embeddings API and CONSOLIDATE still clusters raw vocabulary on
// vectors before the model judges the merges.
//
// The runtime has no inbound JWT authorizer: the browser never calls it. The
// start-agent and extract-pages Lambdas invoke it over SigV4, so
// `bedrock-agentcore:InvokeAgentRuntime` on those two roles is the whole
// authorization story.
export class OntologyAgent extends Construct {
  public readonly startFunction: lambda.Function;
  public readonly statusFunction: lambda.Function;
  public readonly listFunction: lambda.Function;
  public readonly outputsFunction: lambda.Function;
  // The build's job table and gold prefix are what the ontology chat agent reads to
  // answer questions about a finished build, so both are exposed as typed props
  // rather than resolved by name.
  public readonly jobTable: dynamodb.Table;
  // Exposed for the Api stack's purge worker, which aborts a running build by the
  // execution named after its jobId.
  public readonly convertStateMachine: stepfunctions.StateMachine;

  constructor(scope: Construct, id: string, props: OntologyAgentProps) {
    super(scope, id);

    const {
      resourcePrefix,
      bronzeBucket,
      silverBucket,
      goldBucket,
      claudeTokensSecret,
      awsUtilsLayer,
      vectorBucketArn,
      vectorBucketName,
      vectorIndexArn,
      vectorIndexName,
    } = props;
    const stack = cdk.Stack.of(this);
    const agentPath = path.join(__dirname, '../../../../../../apps/ai/agents/ontology');

    // Deterministic references to the converter (owned by the Api stack). Using the
    // physical name/ARN avoids an Ai->Api CloudFormation cycle.
    const converterTriggerName = `${resourcePrefix}-converter-trigger`;
    const converterJobTableName = `${resourcePrefix}-converter-jobs`;
    const converterTriggerArn = `arn:aws:lambda:${stack.region}:${stack.account}:function:${converterTriggerName}`;
    const converterJobTableArn = `arn:aws:dynamodb:${stack.region}:${stack.account}:table/${converterJobTableName}`;

    // Job table — one row per build (status, coarse stage, live extraction counter,
    // gold outputs, and the agent's activity trail). No TTL: a succeeded ontology
    // has to stay retrievable, and the by_owner index is what the saved-ontologies
    // panel queries.
    const jobTable = new dynamodb.Table(this, 'JobTable', {
      tableName: `${resourcePrefix}-ontology-jobs`,
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.jobTable = jobTable;

    jobTable.addGlobalSecondaryIndex({
      indexName: 'by_owner',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Published ontologies, newest first. Deliberately sparse: a private build has
    // neither key attribute set, so it is not in the index at all and the library's
    // "shared" query reads exactly the rows it is allowed to see rather than
    // filtering the whole table. Publishing sets both attributes and unpublishing
    // removes them, which is the whole of the write side.
    //
    // One partition key value means one partition. That is fine for a read-mostly
    // index of published ontologies, and it is the thing to revisit first if
    // publishing ever becomes the default rather than the exception.
    jobTable.addGlobalSecondaryIndex({
      indexName: 'by_visibility',
      partitionKey: { name: 'visibility', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'publishedAt', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // The agent runtime. ARM64 because AgentCore runs containers on aarch64;
    // omitting authorizerConfiguration leaves the default IAM (SigV4) inbound auth.
    const runtime = new agentcore.Runtime(this, 'Runtime', {
      // Runtime names allow letters/digits/underscores only — no hyphens.
      runtimeName: `${resourcePrefix.replace(/-/g, '_')}_ontology_agent`,
      description: 'Claude Agent SDK ontology build (EXTRACT batches and CONSOLIDATE)',
      agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromAsset(agentPath, {
        platform: cdk.aws_ecr_assets.Platform.LINUX_ARM64,
      }),
      networkConfiguration: agentcore.RuntimeNetworkConfiguration.usingPublicNetwork(),
      environmentVariables: {
        JOB_TABLE: jobTable.tableName,
        CLAUDE_TOKENS_SECRET: claudeTokensSecret.secretArn,
        SILVER_BUCKET_NAME: silverBucket.bucketName,
        GOLD_BUCKET_NAME: goldBucket.bucketName,
      },
    });

    // The caller's own Claude token — the only credential the agent's model calls use.
    claudeTokensSecret.grantRead(runtime);

    // Lake access. The agent starts after conversion, so it never touches bronze —
    // it reads the markdown in silver and writes its artifacts to gold. Tenancy is
    // enforced in the handlers from the verified sub, so these grants are per-bucket.
    silverBucket.grantRead(runtime);
    goldBucket.grantReadWrite(runtime);

    jobTable.grantReadWriteData(runtime);

    // Embeddings only. Deliberately narrower than the repo's other Bedrock grants,
    // which allow any foundation model: pinning the model id is what makes "no text
    // generation on the app's account" an IAM fact rather than a convention.
    runtime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'InvokeTitanEmbeddings',
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${stack.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        ],
      })
    );

    // Control plane — packaged from the agent dir so `shared/` is importable, with
    // dotted handlers and the aws_utils layer.
    const controlCode = lambda.Code.fromAsset(agentPath, {
      exclude: [
        'tools/**',
        'statemachine/**',
        'Dockerfile',
        '.dockerignore',
        'requirements.txt',
        '**/__pycache__/**',
        '**/*.pyc',
      ],
    });
    const control = (
      id: string,
      name: string,
      handler: string,
      env: Record<string, string>,
      overrides?: {
        timeout?: cdk.Duration;
        memorySize?: number;
        reservedConcurrentExecutions?: number;
      }
    ): lambda.Function =>
      new lambda.Function(this, id, {
        functionName: `${resourcePrefix}-ontology-${name}`,
        runtime: lambda.Runtime.PYTHON_3_12,
        handler,
        code: controlCode,
        timeout: overrides?.timeout ?? cdk.Duration.seconds(30),
        memorySize: overrides?.memorySize ?? 256,
        reservedConcurrentExecutions: overrides?.reservedConcurrentExecutions,
        layers: [awsUtilsLayer],
        environment: env,
        logGroup: new logs.LogGroup(this, `${id}LogGroup`, {
          logGroupName: `/aws/lambda/${resourcePrefix}-ontology-${name}`,
          retention: logs.RetentionDays.TWO_WEEKS,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      });

    // CARRY_FORWARD. The state machine's first stage, and a no-op for an ordinary
    // build. For a corpus update it copies each kept document's bronze object,
    // converted markdown and extracted elements out of the source build's prefixes,
    // which is what lets CONVERT run over only the added documents and the
    // extraction fan-out skip every carried page.
    const carryForwardFunction = control(
      'CarryForward',
      'carry-forward',
      'control.carry_forward.lambda_handler',
      {
        JOB_TABLE: jobTable.tableName,
        BRONZE_BUCKET_NAME: bronzeBucket.bucketName,
        SILVER_BUCKET_NAME: silverBucket.bucketName,
        GOLD_BUCKET_NAME: goldBucket.bucketName,
      },
      // One round trip per carried object, and a large corpus carries thousands.
      // The copies are server side, so this is latency rather than throughput.
      { timeout: cdk.Duration.minutes(15), memorySize: 1024 }
    );
    jobTable.grantReadWriteData(carryForwardFunction);
    // Both sides of every copy: CopyObject reads the source key and writes the
    // target, and both sit under the same caller's prefix in the same bucket.
    bronzeBucket.grantReadWrite(carryForwardFunction);
    silverBucket.grantReadWrite(carryForwardFunction);
    goldBucket.grantReadWrite(carryForwardFunction);

    // SEGMENT. The fan-in between the conversion Map and everything that reads
    // pages: turns the Map's per-document results into markdown keys plus failed
    // documents, then cuts the markdown into pages and chunks under the build's gold
    // prefix. Wholly deterministic, which is why it is a Lambda and not a role.
    const segmentFunction = control(
      'SegmentBuild',
      'segment',
      'control.segment_build.lambda_handler',
      {
        JOB_TABLE: jobTable.tableName,
        GOLD_BUCKET_NAME: goldBucket.bucketName,
      },
      // Reads every converted markdown file, writes one object per page and streams
      // two of the build's flat outputs, so it needs far more than the control
      // default of 30s. The memory is for the page bodies held between PUT windows.
      { timeout: cdk.Duration.minutes(10), memorySize: 2048 }
    );
    jobTable.grantReadWriteData(segmentFunction);
    silverBucket.grantRead(segmentFunction);
    goldBucket.grantReadWrite(segmentFunction);

    // Diffs the page manifest against the elements that exist and projects the
    // difference where the extraction Map's ItemReader can stream it. Runs once
    // before the fan-out and again after every pass, so the same Map state serves
    // both the initial extraction and every sweep.
    const planExtractFunction = control(
      'PlanExtract',
      'plan-extract',
      'control.plan_extract.lambda_handler',
      {
        JOB_TABLE: jobTable.tableName,
        GOLD_BUCKET_NAME: goldBucket.bucketName,
      },
      { timeout: cdk.Duration.minutes(5), memorySize: 512 }
    );
    jobTable.grantReadWriteData(planExtractFunction);
    goldBucket.grantRead(planExtractFunction);
    goldBucket.grantPut(planExtractFunction);

    // One branch of the extraction Map. It holds a socket open to the runtime for
    // the length of a batch, which is the entire point: the Map's concurrency is the
    // fan-out. Reserved concurrency caps how many batches can be in flight at once
    // whatever the Map is configured to, so a large build cannot starve every other
    // Lambda in the account.
    const extractPagesFunction = control(
      'ExtractPages',
      'extract-pages',
      'control.extract_pages.lambda_handler',
      {
        JOB_TABLE: jobTable.tableName,
        AGENT_RUNTIME_ARN: runtime.agentRuntimeArn,
      },
      {
        timeout: cdk.Duration.minutes(15),
        memorySize: 256,
        reservedConcurrentExecutions: 50,
      }
    );
    // Reads the job row for the owner's sub and email, and nothing else: it touches
    // no bucket and no secret because it does no extraction itself.
    jobTable.grantReadData(extractPagesFunction);
    extractPagesFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'InvokeOntologyAgent',
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [runtime.agentRuntimeArn, `${runtime.agentRuntimeArn}/*`],
      })
    );

    // One pass over the extracted elements that replaces five: the streamable index,
    // the aggregated raw vocabulary, and the corpus-wide extraction counters.
    const compactElementsFunction = control(
      'CompactElements',
      'compact-elements',
      'control.compact_elements.lambda_handler',
      {
        JOB_TABLE: jobTable.tableName,
        GOLD_BUCKET_NAME: goldBucket.bucketName,
      },
      { timeout: cdk.Duration.minutes(10), memorySize: 2048 }
    );
    jobTable.grantReadData(compactElementsFunction);
    goldBucket.grantReadWrite(compactElementsFunction);

    // Hands CONSOLIDATE to the agent. The runtime has no JWT authorizer, so this
    // grant is the entire authorization story for starting an agent run.
    const startAgentFunction = control(
      'StartAgent',
      'start-agent',
      'control.start_agent.lambda_handler',
      {
        JOB_TABLE: jobTable.tableName,
        AGENT_RUNTIME_ARN: runtime.agentRuntimeArn,
      }
    );
    jobTable.grantReadWriteData(startAgentFunction);
    startAgentFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'InvokeOntologyAgent',
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [runtime.agentRuntimeArn, `${runtime.agentRuntimeArn}/*`],
      })
    );

    // CANONICALIZE. Exact matching, content hashing and arithmetic over every
    // element, with no model in the loop — it ran as a subagent only because it sat
    // between two stages that needed one.
    const canonicalizeFunction = control(
      'CanonicalizeBuild',
      'canonicalize',
      'control.canonicalize_build.lambda_handler',
      {
        JOB_TABLE: jobTable.tableName,
        GOLD_BUCKET_NAME: goldBucket.bucketName,
      },
      { timeout: cdk.Duration.minutes(15), memorySize: 3008 }
    );
    jobTable.grantReadWriteData(canonicalizeFunction);
    goldBucket.grantReadWrite(canonicalizeFunction);

    // EMIT. The only place in the pipeline that records a successful terminal status.
    const emitFunction = control(
      'EmitBuild',
      'emit',
      'control.emit_build.lambda_handler',
      {
        JOB_TABLE: jobTable.tableName,
        GOLD_BUCKET_NAME: goldBucket.bucketName,
      },
      { timeout: cdk.Duration.minutes(15), memorySize: 2048 }
    );
    jobTable.grantReadWriteData(emitFunction);
    goldBucket.grantReadWrite(emitFunction);

    // The graph branch's single exit for anything that went wrong. Its write is
    // conditional on the row not already being terminal, so a stage that failed the
    // row with a better reason keeps it.
    const failBuildFunction = control('FailBuild', 'fail', 'control.fail_build.lambda_handler', {
      JOB_TABLE: jobTable.tableName,
    });
    jobTable.grantReadWriteData(failBuildFunction);

    // The build's one human-in-the-loop gate. Called through .waitForTaskToken after a
    // conversion that lost documents, it parks the token on the job row and returns;
    // the execution then waits for the review endpoint to send that token back.
    const awaitReviewFunction = control(
      'AwaitReview',
      'await-review',
      'control.await_review.lambda_handler',
      {
        JOB_TABLE: jobTable.tableName,
      }
    );
    jobTable.grantReadWriteData(awaitReviewFunction);

    // The other half of that gate: when the answer is "retry", this rebuilds the
    // Convert Map's input from the job row and resets the conversion counters, because
    // SEGMENT's OutputPath discards the execution input on its way past. Both bucket
    // names are here to compose an S3 URI, so it needs no permission on either.
    const prepareRetryFunction = control(
      'PrepareRetry',
      'prepare-retry',
      'control.prepare_retry.lambda_handler',
      {
        JOB_TABLE: jobTable.tableName,
        BRONZE_BUCKET_NAME: bronzeBucket.bucketName,
        SILVER_BUCKET_NAME: silverBucket.bucketName,
      }
    );
    jobTable.grantReadWriteData(prepareRetryFunction);

    // Hydrates the page index, one invocation per batch of pages, concurrently with
    // the agent. Embedding is the slow part, hence the 15 minute ceiling.
    const hydrateIndexFunction = control(
      'HydrateIndex',
      'hydrate-index',
      'control.hydrate_index.lambda_handler',
      {
        JOB_TABLE: jobTable.tableName,
        GOLD_BUCKET_NAME: goldBucket.bucketName,
        VECTOR_BUCKET: vectorBucketName,
        VECTOR_INDEX: vectorIndexName,
      },
      { timeout: cdk.Duration.minutes(15), memorySize: 2048 }
    );
    jobTable.grantReadWriteData(hydrateIndexFunction);
    goldBucket.grantRead(hydrateIndexFunction);
    hydrateIndexFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'InvokeTitanEmbeddings',
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${stack.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        ],
      })
    );
    hydrateIndexFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'WritePageVectors',
        actions: ['s3vectors:PutVectors'],
        resources: [vectorBucketArn, vectorIndexArn],
      })
    );

    // CONVERT, then SEGMENT, then the graph and the index in parallel. The ASL lives
    // beside the agent so the Terraform tree consumes exactly the same definition.
    // A template var missing from this chain fails SILENTLY, as a literal `${...}` in
    // the deployed definition, so every var the file uses has to appear here.
    const convertStateMachine = new stepfunctions.StateMachine(this, 'ConvertStateMachine', {
      stateMachineName: `${resourcePrefix}-ontology-convert`,
      stateMachineType: stepfunctions.StateMachineType.STANDARD,
      definitionBody: stepfunctions.DefinitionBody.fromString(
        fs
          .readFileSync(path.join(agentPath, 'statemachine/convert.asl.json'), 'utf8')
          .replace(/\$\{converter_trigger_arn\}/g, converterTriggerArn)
          .replace(/\$\{converter_job_table\}/g, converterJobTableName)
          .replace(/\$\{ontology_job_table\}/g, jobTable.tableName)
          .replace(/\$\{gold_bucket\}/g, goldBucket.bucketName)
          .replace(/\$\{carry_forward_arn\}/g, carryForwardFunction.functionArn)
          .replace(/\$\{segment_build_arn\}/g, segmentFunction.functionArn)
          .replace(/\$\{plan_extract_arn\}/g, planExtractFunction.functionArn)
          .replace(/\$\{extract_pages_arn\}/g, extractPagesFunction.functionArn)
          .replace(/\$\{compact_elements_arn\}/g, compactElementsFunction.functionArn)
          .replace(/\$\{start_agent_arn\}/g, startAgentFunction.functionArn)
          .replace(/\$\{canonicalize_build_arn\}/g, canonicalizeFunction.functionArn)
          .replace(/\$\{emit_build_arn\}/g, emitFunction.functionArn)
          .replace(/\$\{fail_build_arn\}/g, failBuildFunction.functionArn)
          .replace(/\$\{await_review_arn\}/g, awaitReviewFunction.functionArn)
          .replace(/\$\{prepare_retry_arn\}/g, prepareRetryFunction.functionArn)
          .replace(/\$\{hydrate_index_arn\}/g, hydrateIndexFunction.functionArn)
      ),
      // Applied by the ASL's own TimeoutSeconds. This prop is only honoured for a
      // ChainDefinitionBody, so the value in the file is the one that takes effect.
      // 48 hours there rather than 24, because the review gate can hold a build for a
      // whole day on its own and the conversion before it has already spent hours.
      timeout: cdk.Duration.hours(48),
    });

    convertStateMachine.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'InvokeConverterTrigger',
        actions: ['lambda:InvokeFunction'],
        resources: [converterTriggerArn],
      })
    );
    convertStateMachine.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'ReadConverterJobs',
        actions: ['dynamodb:GetItem'],
        resources: [converterJobTableArn],
      })
    );
    // Read for the CONSOLIDATE poll, write for the conversion counter each Convert
    // branch bumps on its way to a terminal Pass state.
    jobTable.grantReadWriteData(convertStateMachine);
    carryForwardFunction.grantInvoke(convertStateMachine);
    segmentFunction.grantInvoke(convertStateMachine);
    planExtractFunction.grantInvoke(convertStateMachine);
    extractPagesFunction.grantInvoke(convertStateMachine);
    compactElementsFunction.grantInvoke(convertStateMachine);
    startAgentFunction.grantInvoke(convertStateMachine);
    canonicalizeFunction.grantInvoke(convertStateMachine);
    emitFunction.grantInvoke(convertStateMachine);
    failBuildFunction.grantInvoke(convertStateMachine);
    awaitReviewFunction.grantInvoke(convertStateMachine);
    prepareRetryFunction.grantInvoke(convertStateMachine);
    hydrateIndexFunction.grantInvoke(convertStateMachine);

    // A Distributed Map runs its branches as CHILD executions, so the state machine
    // has to be able to start and supervise executions of itself. There is no grant
    // helper for this and the ARNs are built rather than referenced, because a policy
    // that referenced the state machine would close a cycle with the machine's own
    // dependency on that policy.
    const stateMachineArn = `arn:aws:states:${stack.region}:${stack.account}:stateMachine:${resourcePrefix}-ontology-convert`;
    const executionArn = `arn:aws:states:${stack.region}:${stack.account}:execution:${resourcePrefix}-ontology-convert/*`;
    convertStateMachine.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'RunDistributedMapChildren',
        actions: ['states:StartExecution'],
        resources: [stateMachineArn],
      })
    );
    convertStateMachine.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'SuperviseDistributedMapChildren',
        actions: ['states:DescribeExecution', 'states:StopExecution', 'states:RedriveExecution'],
        resources: [executionArn],
      })
    );

    // The Maps read their item lists straight out of gold and write their aggregated
    // results back there, so the state machine itself needs S3 access — a first for
    // this construct, and the reason the gold bucket name is a template var.
    goldBucket.grantRead(convertStateMachine);
    goldBucket.grantWrite(convertStateMachine);

    this.startFunction = control('Start', 'start', 'control.start_build.lambda_handler', {
      JOB_TABLE: jobTable.tableName,
      BRONZE_BUCKET_NAME: bronzeBucket.bucketName,
      SILVER_BUCKET_NAME: silverBucket.bucketName,
      GOLD_BUCKET_NAME: goldBucket.bucketName,
      STATE_MACHINE_ARN: convertStateMachine.stateMachineArn,
      CLAUDE_TOKENS_SECRET: claudeTokensSecret.secretArn,
    });
    jobTable.grantReadWriteData(this.startFunction);
    claudeTokensSecret.grantRead(this.startFunction);
    // Schema reuse: read a prior build's schema.json and copy it into the new run prefix.
    goldBucket.grantRead(this.startFunction);
    goldBucket.grantPut(this.startFunction);
    convertStateMachine.grantStartExecution(this.startFunction);
    this.convertStateMachine = convertStateMachine;

    this.statusFunction = control('Status', 'status', 'control.get_build_status.lambda_handler', {
      JOB_TABLE: jobTable.tableName,
    });
    jobTable.grantReadData(this.statusFunction);

    this.listFunction = control('List', 'list', 'control.list_builds.lambda_handler', {
      JOB_TABLE: jobTable.tableName,
    });
    jobTable.grantReadData(this.listFunction);

    this.outputsFunction = control(
      'Outputs',
      'outputs',
      'control.get_build_outputs.lambda_handler',
      {
        JOB_TABLE: jobTable.tableName,
        GOLD_BUCKET_NAME: goldBucket.bucketName,
      }
    );
    jobTable.grantReadData(this.outputsFunction);
    goldBucket.grantRead(this.outputsFunction);
  }
}
