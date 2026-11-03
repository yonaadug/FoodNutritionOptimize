/**
 * ============================================================================
 *  UNTESTED EXAMPLE — NOT DEPLOYED, NOT TYPE-CHECKED AGAINST A PINNED CDK VERSION.
 *  Reference for docs/aws/AWS_HOSTING_DESIGN.md (Option A). Review every line,
 *  run `cdk synth` and `cdk diff` in a DEV account before using it anywhere.
 * ============================================================================
 *
 * NutriCompare stack (one per stage: dev | prod):
 *   CloudFront (OAC) -> Lambda "web" (Next.js standalone in an arm64 container via Lambda Web Adapter)
 *   DynamoDB single table · Cognito user pool · S3 uploads · SQS imports + DLQ
 *   Lambda "ai-worker" (Claude via Claude Platform on AWS) · Lambda "stripe-webhook" (public URL)
 *   Lambda "kill-switch" · CloudWatch alarms · AWS Budget · SNS alerts
 *
 * Assumes the app repo layout:
 *   food-nutrition-app/Dockerfile.lambda          (see ../Dockerfile.lambda)
 *   food-nutrition-app/workers/import.ts          (AI worker handler, to be written)
 *   food-nutrition-app/workers/stripe-webhook.ts  (webhook handler, to be written)
 */
import * as path from 'path';
import { Duration, RemovalPolicy, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

export interface NutriCompareStackProps extends StackProps {
  stage: 'dev' | 'prod';
  /** e.g. "https://nutricompare.app" (prod) or the CloudFront URL (dev). Used for CORS + Stripe redirects. */
  siteUrl: string;
  alertEmail: string;
  /** Monthly AWS cost budget in USD (start small; raise with revenue). */
  monthlyBudgetUsd: number;
  /** Verified SES domain for Cognito emails, e.g. "nutricompare.app". Optional in dev. */
  sesDomain?: string;
}

export class NutriCompareStack extends Stack {
  constructor(scope: Construct, id: string, props: NutriCompareStackProps) {
    super(scope, id, props);
    const isProd = props.stage === 'prod';
    const appDir = path.join(__dirname, '../../../../../food-nutrition-app');
    const paramPrefix = `/nutricompare/${props.stage}`;

    // ---------------------------------------------------------------- alerts
    const alerts = new sns.Topic(this, 'Alerts');
    alerts.addSubscription(new subs.EmailSubscription(props.alertEmail));
    // Allow AWS Budgets to publish to the topic.
    alerts.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['sns:Publish'],
      principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
      resources: [alerts.topicArn],
    }));
    const alarmAction = new cwActions.SnsAction(alerts);

    // ------------------------------------------------------------ data store
    const table = new dynamodb.TableV2(this, 'Table', {
      tableName: `nutricompare-${props.stage}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'expiresAt',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProd }, // $0.20/GB-month
      deletionProtection: isProd,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      globalSecondaryIndexes: [{
        indexName: 'GSI1', // STRIPECUS#<cus_id> -> USER#<sub>
        partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      }],
    });

    // ------------------------------------------------------------------ auth
    const userPool = new cognito.UserPool(this, 'Users', {
      userPoolName: `nutricompare-${props.stage}`,
      featurePlan: cognito.FeaturePlan.ESSENTIALS, // 10k MAU free; switch to LITE later if needed
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      signInPolicy: { allowedFirstAuthFactors: { password: true, emailOtp: true } },
      passwordPolicy: { minLength: 10 },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      email: props.sesDomain
        ? cognito.UserPoolEmail.withSES({
            fromEmail: `no-reply@${props.sesDomain}`,
            fromName: 'NutriCompare',
            sesRegion: this.region,
            sesVerifiedDomain: props.sesDomain,
          })
        : cognito.UserPoolEmail.withCognito(), // low daily limit — dev only
      deletionProtection: isProd,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    const webClient = userPool.addClient('WebClient', {
      generateSecret: false,
      preventUserExistenceErrors: true,
      authFlows: { userSrp: true, user: true }, // `user` = choice-based auth (email OTP)
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });
    // Google sign-in: add cognito.UserPoolIdentityProviderGoogle with client id/secret from SSM (omitted).

    // --------------------------------------------------------------- uploads
    const uploads = new s3.Bucket(this, 'Uploads', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [{ expiration: Duration.days(1) }], // photos are transient
      cors: [{
        allowedMethods: [s3.HttpMethods.POST, s3.HttpMethods.PUT],
        allowedOrigins: [props.siteUrl],
        allowedHeaders: ['*'],
        maxAge: 3000,
      }],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    // ----------------------------------------------------------------- queue
    const importsDlq = new sqs.Queue(this, 'ImportsDLQ', { retentionPeriod: Duration.days(14) });
    const imports = new sqs.Queue(this, 'Imports', {
      visibilityTimeout: Duration.seconds(180), // >= 3x worker timeout
      deadLetterQueue: { queue: importsDlq, maxReceiveCount: 3 },
    });

    // ------------------------------------------------------- web (Next.js)
    const commonEnv = {
      STAGE: props.stage,
      TABLE_NAME: table.tableName,
      SITE_URL: props.siteUrl,
      PARAM_PREFIX: paramPrefix,
    };
    const web = new lambda.DockerImageFunction(this, 'Web', {
      code: lambda.DockerImageCode.fromImageAsset(appDir, {
        file: 'Dockerfile.lambda',
        platform: ecrAssets.Platform.LINUX_ARM64,
      }),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: Duration.seconds(15),
      reservedConcurrentExecutions: isProd ? 25 : 5, // caps spend rate; needs account quota > default for new accounts
      environment: {
        ...commonEnv,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: webClient.userPoolClientId,
        UPLOADS_BUCKET: uploads.bucketName,
        IMPORTS_QUEUE_URL: imports.queueUrl,
        NUTRITION_DB_PATH: '/app/data/nutrition.db',
      },
      logGroup: new logs.LogGroup(this, 'WebLogs', {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    table.grantReadWriteData(web);
    uploads.grantPut(web); // presigned POST is signed with the function's role
    imports.grantSendMessages(web);
    web.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter', 'ssm:GetParametersByPath'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${paramPrefix}/*`],
    }));
    web.addToRolePolicy(new iam.PolicyStatement({ // account deletion
      actions: ['cognito-idp:AdminDeleteUser'],
      resources: [userPool.userPoolArn],
    }));

    // Function URL protected by CloudFront OAC (AuthType AWS_IAM).
    // NOTE: with OAC, browsers must send `x-amz-content-sha256` on POST/PUT, and the
    // Cognito JWT must travel in a custom header (e.g. X-Auth-Token), not `Authorization`.
    const webUrl = web.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });
    const webOrigin = origins.FunctionUrlOrigin.withOriginAccessControl(webUrl);

    // Food data is read-only + versioned → cache at the edge keyed on query string only.
    const foodApiCache = new cloudfront.CachePolicy(this, 'FoodApiCache', {
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.hours(1),
      maxTtl: Duration.days(7),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });
    const foodApi: cloudfront.BehaviorOptions = {
      origin: webOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      cachePolicy: foodApiCache,
      compress: true,
    };

    // 5 behaviors total = the flat-rate Free plan's limit.
    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      comment: `nutricompare-${props.stage}`,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // irrelevant on flat-rate plans; cheaper on PAYG
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin: webOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.USE_ORIGIN_CACHE_CONTROL_HEADERS_QUERY_STRINGS,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        compress: true,
      },
      additionalBehaviors: {
        '/_next/static/*': {
          origin: webOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          compress: true,
        },
        '/api/search*': foodApi,
        '/api/foods/*': foodApi,
        '/api/food*': foodApi,
      },
      // domainNames + certificate (ACM in us-east-1) for prod — omitted here.
      // After deploy: subscribe this distribution to the CloudFront flat-rate Free plan in the console
      // ("Manage plan"); account must be on the AWS *Paid* plan. WAF rate-based rules come with the plan.
    });

    // ------------------------------------------------------------ AI worker
    const aiEnabledParam = new ssm.StringParameter(this, 'AiEnabled', {
      parameterName: `${paramPrefix}/ai-enabled`,
      stringValue: 'true',
    });
    const aiWorker = new nodejs.NodejsFunction(this, 'AiWorker', {
      entry: path.join(appDir, 'workers/import.ts'),
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(60),
      reservedConcurrentExecutions: 2, // hard ceiling on concurrent Claude calls
      environment: {
        ...commonEnv,
        UPLOADS_BUCKET: uploads.bucketName,
        AI_ENABLED_PARAM: aiEnabledParam.parameterName,
        // Claude Platform on AWS (SigV4 via this role): region + workspace id are required by the SDK.
        ANTHROPIC_AWS_WORKSPACE_ID: 'REPLACE_ME',
        MODEL_PRIMARY: 'claude-haiku-5-5',
        MODEL_ESCALATION: 'claude-sonnet-5-5',
      },
      bundling: { minify: true, sourceMap: true },
      logGroup: new logs.LogGroup(this, 'AiWorkerLogs', {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    aiWorker.addEventSource(new SqsEventSource(imports, { batchSize: 1, maxConcurrency: 2 }));
    table.grantReadWriteData(aiWorker);
    uploads.grantRead(aiWorker);
    aiEnabledParam.grantRead(aiWorker);
    // TODO(verify): exact IAM action names/resources for Claude Platform on AWS
    // (service prefix appears as "aws-external-anthropic"; scope to your workspace ARN once known).
    aiWorker.addToRolePolicy(new iam.PolicyStatement({
      actions: ['aws-external-anthropic:*'],
      resources: ['*'],
    }));

    // ------------------------------------------------------- Stripe webhook
    // Separate function with a PUBLIC Function URL: Stripe cannot add the sha256 header OAC requires.
    // Authenticity comes from verifying the Stripe-Signature header against the webhook secret.
    const stripeWebhook = new nodejs.NodejsFunction(this, 'StripeWebhook', {
      entry: path.join(appDir, 'workers/stripe-webhook.ts'),
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      reservedConcurrentExecutions: 5,
      environment: { ...commonEnv },
      logGroup: new logs.LogGroup(this, 'StripeWebhookLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    table.grantReadWriteData(stripeWebhook);
    stripeWebhook.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${paramPrefix}/stripe/*`],
    }));
    const webhookUrl = stripeWebhook.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
    // Create SecureString params out-of-band (CloudFormation can't create SecureString):
    //   aws ssm put-parameter --type SecureString --name /nutricompare/prod/stripe/secret-key --value sk_live_...
    //   aws ssm put-parameter --type SecureString --name /nutricompare/prod/stripe/webhook-secret --value whsec_...

    // --------------------------------------------------------- kill switch
    const killSwitch = new lambda.Function(this, 'KillSwitch', {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      timeout: Duration.seconds(10),
      environment: { PARAM: aiEnabledParam.parameterName, WORKER: aiWorker.functionName },
      code: lambda.Code.fromInline(`
        const { SSMClient, PutParameterCommand } = require('@aws-sdk/client-ssm');
        const { LambdaClient, PutFunctionConcurrencyCommand } = require('@aws-sdk/client-lambda');
        exports.handler = async (event) => {
          console.log(JSON.stringify({ msg: 'kill-switch fired', event }));
          await new SSMClient({}).send(new PutParameterCommand({ Name: process.env.PARAM, Value: 'false', Type: 'String', Overwrite: true }));
          await new LambdaClient({}).send(new PutFunctionConcurrencyCommand({ FunctionName: process.env.WORKER, ReservedConcurrentExecutions: 0 }));
        };`),
    });
    aiEnabledParam.grantWrite(killSwitch);
    killSwitch.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:PutFunctionConcurrency'],
      resources: [aiWorker.functionArn],
    }));
    // Separate topic so ordinary alarms don't trip the kill switch.
    const killTopic = new sns.Topic(this, 'KillSwitchTopic');
    killTopic.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['sns:Publish'],
      principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
      resources: [killTopic.topicArn],
    }));
    killTopic.addSubscription(new subs.LambdaSubscription(killSwitch));
    killTopic.addSubscription(new subs.EmailSubscription(props.alertEmail));

    // ------------------------------------------------------------ alarms (≤10 free)
    const alarm = (id: string, metric: cw.IMetric, threshold: number, periods = 1) =>
      new cw.Alarm(this, id, {
        metric, threshold, evaluationPeriods: periods,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(alarmAction);

    alarm('Web5xx', new cw.Metric({
      namespace: 'AWS/Lambda', metricName: 'Url5xxCount',
      dimensionsMap: { FunctionName: web.functionName }, statistic: 'Sum', period: Duration.minutes(5),
    }), 5);
    alarm('WebThrottles', web.metricThrottles({ period: Duration.minutes(5) }), 0);
    alarm('WebP95', web.metricDuration({ statistic: 'p95', period: Duration.minutes(5) }), 3000, 3);
    alarm('WorkerErrors', aiWorker.metricErrors({ period: Duration.minutes(15) }), 3);
    alarm('ImportsDlq', importsDlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5) }), 0);
    alarm('WebhookErrors', stripeWebhook.metricErrors({ period: Duration.minutes(5) }), 0);
    alarm('DdbThrottles', new cw.MathExpression({
      expression: 'r + w',
      usingMetrics: {
        r: table.metric('ReadThrottleEvents', { statistic: 'Sum', period: Duration.minutes(5) }),
        w: table.metric('WriteThrottleEvents', { statistic: 'Sum', period: Duration.minutes(5) }),
      },
    }), 0);
    // App emits NutriCompare/AiSpendMicroUsd via Embedded Metric Format; alert at ~80% of the daily cap.
    alarm('AiSpendDaily', new cw.Metric({
      namespace: 'NutriCompare', metricName: 'AiSpendMicroUsd',
      dimensionsMap: { Stage: props.stage }, statistic: 'Sum', period: Duration.days(1),
    }), 4_000_000 /* $4 */);

    // ---------------------------------------------------------------- budget
    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `nutricompare-${props.stage}-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: props.monthlyBudgetUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        { notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 50, thresholdType: 'PERCENTAGE' },
          subscribers: [{ subscriptionType: 'SNS', address: alerts.topicArn }] },
        { notification: { notificationType: 'FORECASTED', comparisonOperator: 'GREATER_THAN', threshold: 100, thresholdType: 'PERCENTAGE' },
          subscribers: [{ subscriptionType: 'SNS', address: alerts.topicArn }] },
        { notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 150, thresholdType: 'PERCENTAGE' },
          subscribers: [{ subscriptionType: 'SNS', address: killTopic.topicArn }] }, // backstop: AI off
      ],
    });

    // --------------------------------------------------------------- outputs
    new CfnOutput(this, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'StripeWebhookUrl', { value: webhookUrl.url });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: webClient.userPoolClientId });
    new CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
