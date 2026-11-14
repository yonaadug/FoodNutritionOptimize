/**
 * ============================================================================
 *  EXAMPLE — SYNTH-TESTED, NEVER DEPLOYED. Type-checks and `cdk synth`s against
 *  the pinned aws-cdk-lib in package.json (no AWS credentials or lookups needed).
 *  The owner's runbook is docs/DEPLOY.md; the decisions it follows are in
 *  docs/DECISIONS.md. Deploy to the dev account first.
 * ============================================================================
 *
 * NutritionDictionary stack (one per stage, each in its own account):
 *   CloudFront (flat-rate Free plan + WAF, custom domain, OAC)
 *     -> Lambda "web" (Next.js standalone in an arm64 container via Lambda Web Adapter)
 *     -> Lambda "stripe-webhook" (same image, public URL, only /api/stripe/webhook routes to it)
 *   DynamoDB single table (accounts, history) · S3 uploads (1 day) · SQS imports + DLQ + worker
 *   Sign-in: Better Auth in the web function (email links via SES, plus Google). No Cognito.
 *   Secrets: SSM SecureString, read at cold start by the image's start script (lambda-secrets/).
 *   Guardrails: alarms, AWS Budget (80% / 100% email, 150% kill switch), reserved concurrency.
 *
 * Paths (relative to the repository root):
 *   docs/aws/infra-example/Dockerfile.lambda          web image; build context = repo root
 *   docs/aws/infra-example/lambda-secrets/start.mjs   SSM -> environment, then starts Next
 *   docs/aws/infra-example/cdk/workers/import.ts      SQS imports worker (placeholder stub)
 */
import * as path from 'path';
import { Duration, RemovalPolicy, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as pricingplan from 'aws-cdk-lib/aws-pricingplanmanager';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
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

export interface NutritionDictionaryStackProps extends StackProps {
  stage: 'dev' | 'prod';
  /** The stage's hosted zone (from NutritionDictionaryDns-<stage>). */
  zone: route53.IPublicHostedZone;
  /** The site's own name: "nutritiondictionary.com" (prod) or "dev.nutritiondictionary.com". */
  siteDomain: string;
  /** Extra names that 301 to siteDomain, e.g. ["www.nutritiondictionary.com"]. */
  redirectDomains: string[];
  /** SES domain identity the sign-in emails are sent from (created by the Dns stack). */
  emailIdentityName: string;
  /** AUTH_EMAIL_FROM, e.g. "NutritionDictionary <no-reply@nutritiondictionary.com>". */
  emailFrom: string;
  /** Alarm, budget and kill-switch emails. Undefined only for CI's synthOnly check. */
  alertEmail?: string;
  /** Monthly AWS cost budget in USD for this account. */
  monthlyBudgetUsd: number;
  /** AI_DAILY_BUDGET_USD: the app stops calling Bedrock once today's estimate reaches it. */
  aiDailyBudgetUsd: number;
  /** Subscribe the distribution to the CloudFront flat-rate Free plan (with a WAF web ACL). */
  flatRatePlan: boolean;
}

/** Retention for every log group in the stack (docs/DECISIONS.md: logs kept 14 days). */
const LOG_RETENTION = logs.RetentionDays.TWO_WEEKS;

export class NutritionDictionaryStack extends Stack {
  constructor(scope: Construct, id: string, props: NutritionDictionaryStackProps) {
    super(scope, id, props);
    const isProd = props.stage === 'prod';
    // lib/ -> cdk/ -> infra-example/ -> aws/ -> docs/ -> repo root
    const repoRoot = path.join(__dirname, '../../../../..');
    const workersDir = path.join(__dirname, '../workers');
    const paramPrefix = `/nutrition-dictionary/${props.stage}`;
    const siteUrl = `https://${props.siteDomain}`;
    const logGroup = (id: string) => new logs.LogGroup(this, id, { retention: LOG_RETENTION, removalPolicy: RemovalPolicy.DESTROY });

    // ---------------------------------------------------------------- alerts
    const alerts = new sns.Topic(this, 'Alerts', { displayName: `NutritionDictionary ${props.stage} alerts` });
    if (props.alertEmail) alerts.addSubscription(new subs.EmailSubscription(props.alertEmail));
    // Allow AWS Budgets to publish to the topic.
    alerts.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['sns:Publish'],
      principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
      resources: [alerts.topicArn],
    }));
    const alarmAction = new cwActions.SnsAction(alerts);

    // ------------------------------------------------------------ data store
    // Layout: food-nutrition-app/lib/user-store/table.ts and docs/ACCOUNTS.md ("Storage").
    // Both indexes are sparse and project ALL, as lib/user-store/dynamo-table.ts expects.
    const table = new dynamodb.TableV2(this, 'Table', {
      tableName: `nutrition-dictionary-${props.stage}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'expiresAt', // sessions, sign-in tokens, rate-limit counters
      // 35-day point-in-time recovery in prod ($0.20/GB-month). The privacy policy says a
      // deleted account can remain in these backups for up to 35 days.
      pointInTimeRecoverySpecification: isProd
        ? { pointInTimeRecoveryEnabled: true, recoveryPeriodInDays: 35 }
        : { pointInTimeRecoveryEnabled: false },
      deletionProtection: isProd,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      globalSecondaryIndexes: [
        {
          indexName: 'GSI1', // all history by recency: USER#<id>#HIST (and STRIPECUS#<cus_id> later)
          partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
        },
        {
          indexName: 'GSI2', // history per kind: USER#<id>#HIST#<kind>
          partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    // --------------------------------------------------------------- uploads
    const uploads = new s3.Bucket(this, 'Uploads', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [{ expiration: Duration.days(1), abortIncompleteMultipartUploadAfter: Duration.days(1) }], // photos are transient
      cors: [{
        allowedMethods: [s3.HttpMethods.POST, s3.HttpMethods.PUT],
        allowedOrigins: [siteUrl],
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

    // ------------------------------------------------------- recipe AI (Bedrock)
    // /api/recipes/parse reads recipes synchronously in the web function, each
    // model through its US cross-region inference profile (docs/BEDROCK_SETUP.md):
    // Haiku reads, Sonnet re-reads plated-food photos and failed reads, and Nova
    // 2 Lite takes over while Claude is unavailable (lib/ai/router.ts). Each
    // profile can route to any of these regions, so each needs the
    // foundation-model grant. Pasted text the built-in reader is sure of never
    // reaches Bedrock.
    const recipeModels = {
      main: 'anthropic.claude-haiku-5-5',
      escalation: 'anthropic.claude-sonnet-5-5',
      fallback: 'amazon.nova-2-lite-v1:0',
    };
    const recipeProfileArn = (model: string) => `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.${model}`;
    const recipeModelRegions = ['us-east-1', 'us-east-2', 'us-west-2'];

    // --------------------------------------------------------------- secrets
    // SSM SecureString parameters the owner creates by hand (docs/DEPLOY.md, "Secrets").
    // CloudFormation can't create SecureStrings, and secret values never go in code. The
    // functions get only the names (SSM_SECRETS); lambda-secrets/start.mjs reads the values
    // at cold start. A parameter that doesn't exist yet only turns its feature off.
    const stripeMode = isProd ? 'live' : 'test';
    const stripeEnv = isProd ? 'STRIPE_' : 'STRIPE_TEST_'; // lib/stripe reads STRIPE_TEST_* when STRIPE_MODE=test (docs/STRIPE_PLAN.md)
    const secret = {
      authSecret: { env: 'AUTH_SECRET', param: `${paramPrefix}/auth/secret` },
      googleClientId: { env: 'GOOGLE_CLIENT_ID', param: `${paramPrefix}/auth/google-client-id` },
      googleClientSecret: { env: 'GOOGLE_CLIENT_SECRET', param: `${paramPrefix}/auth/google-client-secret` },
      stripeSecretKey: { env: `${stripeEnv}SECRET_KEY`, param: `${paramPrefix}/stripe/secret-key` },
      stripeWebhookSecret: { env: `${stripeEnv}WEBHOOK_SECRET`, param: `${paramPrefix}/stripe/webhook-secret` },
    };
    type Secret = (typeof secret)[keyof typeof secret];
    const ssmSecrets = (list: Secret[]) => list.map(s => `${s.env}=${s.param}`).join(',');
    const grantSecrets = (fn: lambda.IFunction, list: Secret[]) => fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameters'],
      resources: list.map(s => `arn:aws:ssm:${this.region}:${this.account}:parameter${s.param}`),
    }));
    // SecureStrings use the account's AWS-managed key (aws/ssm), whose key policy already
    // lets any principal in the account decrypt through SSM. No kms: grant needed.

    // ------------------------------------------------------- web (Next.js)
    // Build context = repo root; the root .dockerignore limits it to food-nutrition-app/
    // plus the Lambda files under docs/aws/infra-example/.
    const image = () => lambda.DockerImageCode.fromImageAsset(repoRoot, {
      file: 'docs/aws/infra-example/Dockerfile.lambda',
      platform: ecrAssets.Platform.LINUX_ARM64,
    });
    const webLogs = logGroup('WebLogs');
    const webSecrets = [secret.authSecret, secret.googleClientId, secret.googleClientSecret, secret.stripeSecretKey];
    const web = new lambda.DockerImageFunction(this, 'Web', {
      code: image(),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      // Recipe reading waits on Bedrock (a few seconds on Haiku). Keep this under
      // CloudFront's origin response timeout (30 s by default).
      timeout: Duration.seconds(28),
      // Caps how fast money can be spent in prod. A new account's concurrency quota (often 10)
      // allows no reservation at all, so dev reserves nothing: its small account limit and its
      // $5 budget are the cap there (docs/DEPLOY.md, step 4).
      reservedConcurrentExecutions: isProd ? 25 : undefined,
      environment: {
        STAGE: props.stage,
        NUTRITION_DB_PATH: '/app/data/nutrition.db',
        SSM_SECRETS: ssmSecrets(webSecrets),

        // Accounts (food-nutrition-app/lib/auth/config.ts, docs/ACCOUNTS.md)
        USER_STORE: 'dynamodb',
        DYNAMODB_TABLE: table.tableName,
        AUTH_BASE_URL: siteUrl,
        NEXT_PUBLIC_SITE_URL: siteUrl,
        AUTH_EMAIL_TRANSPORT: 'ses',
        AUTH_EMAIL_FROM: props.emailFrom,
        // CloudFront adds this header (viewer IP:port) through the AllViewerExceptHostHeader
        // origin request policy below. Without it every visitor shares one sign-in rate limit.
        AUTH_IP_HEADERS: 'cloudfront-viewer-address',

        // Plus (docs/STRIPE_PLAN.md). Keys come from SSM; test mode in dev, live in prod.
        STRIPE_MODE: stripeMode,

        // Recipe AI (food-nutrition-app/.env.example, "AI")
        AI_PROVIDER: 'bedrock',
        AI_BUILTIN_TEXT: 'on',
        AI_BEDROCK_REGION: this.region,
        AI_MODEL: `us.${recipeModels.main}`,
        AI_ESCALATION_MODEL: `us.${recipeModels.escalation}`,
        AI_FALLBACK_MODEL: `us.${recipeModels.fallback}`,
        AI_TIMEOUT_MS: '20000',
        AI_MAX_RETRIES: '1',
        // Per instance. With reserved concurrency as the instance cap, the AWS Budget and
        // its kill switch are the account-wide backstop.
        AI_DAILY_BUDGET_USD: String(props.aiDailyBudgetUsd),

        // Not used by the app yet (photo uploads and imports go through the web function today).
        UPLOADS_BUCKET: uploads.bucketName,
        IMPORTS_QUEUE_URL: imports.queueUrl,
      },
      logGroup: webLogs,
    });
    table.grantReadWriteData(web);
    uploads.grantPut(web); // presigned POST is signed with the function's role
    imports.grantSendMessages(web);
    grantSecrets(web, webSecrets);
    // Sign-in emails: only from this stage's domain identity.
    const sesIdentityArn = (name: string) => `arn:aws:ses:${this.region}:${this.account}:identity/${name}`;
    web.addToRolePolicy(new iam.PolicyStatement({
      sid: 'SendSignInEmail',
      actions: ['ses:SendEmail'],
      resources: [sesIdentityArn(props.emailIdentityName)],
    }));
    if (!isProd) {
      // The dev account stays in the SES sandbox, where every recipient must be an email
      // address you verified in this account. SES can check the send against that
      // recipient identity too, so dev may also send to verified *addresses* (never other
      // domains). Prod has production access and needs only the domain.
      web.addToRolePolicy(new iam.PolicyStatement({
        sid: 'SendToSandboxRecipients',
        actions: ['ses:SendEmail'],
        resources: [sesIdentityArn('*@*')],
      }));
    }
    // Bedrock: only the three recipe models, each only through its own inference
    // profile. No aws-marketplace permissions: the owner creates the Claude models'
    // Marketplace agreements once, by hand (docs/BEDROCK_SETUP.md). Nova needs none.
    web.addToRolePolicy(new iam.PolicyStatement({
      sid: 'RecipeModelProfiles',
      actions: ['bedrock:InvokeModel'],
      resources: Object.values(recipeModels).map(recipeProfileArn),
    }));
    for (const [tier, model] of Object.entries(recipeModels)) {
      web.addToRolePolicy(new iam.PolicyStatement({
        sid: `RecipeModelViaProfile${tier[0].toUpperCase()}${tier.slice(1)}`,
        actions: ['bedrock:InvokeModel'],
        resources: recipeModelRegions.map(r => `arn:aws:bedrock:${r}::foundation-model/${model}`),
        conditions: { StringEquals: { 'bedrock:InferenceProfileArn': recipeProfileArn(model) } },
      }));
    }

    // Function URL protected by CloudFront OAC (AuthType AWS_IAM). With OAC, a browser
    // POST/PUT must carry `x-amz-content-sha256` (the body's SHA-256), because Lambda
    // doesn't accept unsigned payloads. lib/auth/client.ts (apiFetch) sends it.
    const webUrl = web.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });
    const webOrigin = origins.FunctionUrlOrigin.withOriginAccessControl(webUrl);

    // ------------------------------------------------------- Stripe webhook
    // Stripe can't add the SHA-256 header OAC requires, so CloudFront sends
    // /api/stripe/webhook to a second function with a public URL. It runs the same image,
    // so the app's own route (app/api/stripe/webhook, docs/STRIPE_PLAN.md) answers, and it
    // verifies the Stripe-Signature header itself. This function gets no Bedrock, SES or
    // sign-in secrets, so the rest of the app is inert if someone calls its URL directly.
    const webhookSecrets = [secret.stripeSecretKey, secret.stripeWebhookSecret];
    const stripeWebhook = new lambda.DockerImageFunction(this, 'StripeWebhook', {
      code: image(),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(15),
      reservedConcurrentExecutions: isProd ? 5 : undefined, // dev: see the web function
      environment: {
        STAGE: props.stage,
        NUTRITION_DB_PATH: '/app/data/nutrition.db',
        SSM_SECRETS: ssmSecrets(webhookSecrets),
        USER_STORE: 'dynamodb',
        DYNAMODB_TABLE: table.tableName,
        NEXT_PUBLIC_SITE_URL: siteUrl,
        STRIPE_MODE: stripeMode,
      },
      logGroup: logGroup('StripeWebhookLogs'),
    });
    table.grantReadWriteData(stripeWebhook);
    grantSecrets(stripeWebhook, webhookSecrets);
    const webhookUrl = stripeWebhook.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
    const webhookOrigin = new origins.FunctionUrlOrigin(webhookUrl);

    // ------------------------------------------------------------ CloudFront
    // Everything here is allowed on the flat-rate Free plan: managed cache and origin
    // request policies only (custom ones need Business), one CloudFront Function, one
    // web ACL, ACM certificate, no geo restriction (the site is worldwide).
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: props.siteDomain,
      subjectAlternativeNames: props.redirectDomains.length ? props.redirectDomains : undefined,
      validation: acm.CertificateValidation.fromDns(props.zone), // records go in the zone automatically
    });

    // www -> apex, keeping the path and query string. 301, so search engines index one name.
    const redirectFn = props.redirectDomains.length ? new cloudfront.Function(this, 'RedirectToApex', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: `301 ${props.redirectDomains.join(', ')} to ${props.siteDomain}`,
      code: cloudfront.FunctionCode.fromInline(redirectFunctionCode(props.redirectDomains, props.siteDomain)),
    }) : undefined;

    // The Free plan's firewall: the plan requires a web ACL on the distribution and covers
    // its cost (5 rules). Outside a plan this ACL would cost about $8/month, so it exists
    // only together with the subscription below.
    const webAcl = props.flatRatePlan ? new wafv2.CfnWebACL(this, 'WebAcl', {
      name: `nutrition-dictionary-${props.stage}`,
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: `nutrition-dictionary-${props.stage}`, sampledRequestsEnabled: true },
      rules: [
        managedRule('AmazonIpReputationList', 0),
        managedRule('KnownBadInputsRuleSet', 1),
        {
          // Per viewer IP, over 5 minutes, ignoring static files (a page load fetches many).
          // The app has its own, tighter limits for sign-in and AI.
          name: 'RateLimitPerIp',
          priority: 2,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 1000,
              evaluationWindowSec: 300,
              aggregateKeyType: 'IP',
              scopeDownStatement: {
                notStatement: {
                  statement: {
                    byteMatchStatement: {
                      fieldToMatch: { uriPath: {} },
                      positionalConstraint: 'STARTS_WITH',
                      searchString: '/_next/static/',
                      textTransformations: [{ priority: 0, type: 'NONE' }],
                    },
                  },
                },
              },
            },
          },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'RateLimitPerIp', sampledRequestsEnabled: true },
        },
      ],
    }) : undefined;

    // Managed policies honor the origin's Cache-Control. AllViewerExceptHostHeader forwards
    // cookies, the query string and every viewer header except Host (a Function URL needs
    // its own Host), plus CloudFront's viewer-location headers, which include
    // CloudFront-Viewer-Address (the client IP the app rate-limits on).
    const originRequestPolicy = cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER;
    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      comment: `nutrition-dictionary-${props.stage}`,
      domainNames: [props.siteDomain, ...props.redirectDomains],
      certificate,
      webAclId: webAcl?.attrArn,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL, // worldwide; flat-rate plans don't bill by price class
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin: webOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.USE_ORIGIN_CACHE_CONTROL_HEADERS_QUERY_STRINGS,
        originRequestPolicy,
        compress: true,
        functionAssociations: redirectFn ? [{ function: redirectFn, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }] : undefined,
      },
      additionalBehaviors: {
        '/_next/static/*': {
          origin: webOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          compress: true,
        },
        '/api/stripe/webhook': {
          origin: webhookOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy,
        },
      },
    });

    for (const name of [props.siteDomain, ...props.redirectDomains]) {
      const recordName = name === props.zone.zoneName ? undefined : name;
      const target = route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution));
      const idPart = name.replace(/[^a-zA-Z0-9]/g, '');
      new route53.ARecord(this, `Alias4${idPart}`, { zone: props.zone, recordName, target });
      new route53.AaaaRecord(this, `Alias6${idPart}`, { zone: props.zone, recordName, target });
    }

    // CloudFront flat-rate Free plan: $0, no overage charges, and it also covers the WAF
    // web ACL and this stage's Route 53 zone. The account must be on the AWS Paid plan
    // (accounts in an Organization are). If the subscription fails, deploy with
    // -c flatRatePlan=false to fall back to pay-as-you-go without WAF.
    if (webAcl) {
      new pricingplan.CfnSubscription(this, 'FlatRatePlan', {
        planFamily: 'CloudFront',
        planTier: 'FREE',
        usageLevel: 'DEFAULT',
        resourceArns: [distribution.distributionArn, webAcl.attrArn, props.zone.hostedZoneArn],
      });
    }

    // ------------------------------------------------------------ AI worker
    const aiEnabledParam = new ssm.StringParameter(this, 'AiEnabled', {
      parameterName: `${paramPrefix}/ai-enabled`,
      stringValue: 'true',
    });
    const aiWorker = new nodejs.NodejsFunction(this, 'AiWorker', {
      entry: path.join(workersDir, 'import.ts'),
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(60),
      reservedConcurrentExecutions: isProd ? 2 : undefined, // prod: hard ceiling on concurrent Claude calls
      environment: {
        STAGE: props.stage,
        DYNAMODB_TABLE: table.tableName,
        UPLOADS_BUCKET: uploads.bucketName,
        AI_ENABLED_PARAM: aiEnabledParam.parameterName,
        // Claude Platform on AWS (SigV4 via this role): region + workspace id are required by the SDK.
        ANTHROPIC_AWS_WORKSPACE_ID: 'REPLACE_ME',
        MODEL_PRIMARY: 'claude-haiku-5-5',
        MODEL_ESCALATION: 'claude-sonnet-5-5',
      },
      bundling: { minify: true, sourceMap: true },
      logGroup: logGroup('AiWorkerLogs'),
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

    // --------------------------------------------------------- kill switch
    // Fired by the budget at 150%. Turns AI off and leaves the site up:
    //  - adds an explicit Deny on Bedrock to the web role, so /recipes says the reader
    //    isn't available (the built-in reader for pasted text keeps working);
    //  - sets the ai-enabled flag to false and the worker's concurrency to 0.
    // Undo: docs/DEPLOY.md, "Turn AI back on".
    const killSwitch = new lambda.Function(this, 'KillSwitch', {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      timeout: Duration.seconds(10),
      logGroup: logGroup('KillSwitchLogs'),
      environment: { PARAM: aiEnabledParam.parameterName, WORKER: aiWorker.functionName, WEB_ROLE: web.role!.roleName },
      code: lambda.Code.fromInline(`
        const { SSMClient, PutParameterCommand } = require('@aws-sdk/client-ssm');
        const { LambdaClient, PutFunctionConcurrencyCommand } = require('@aws-sdk/client-lambda');
        const { IAMClient, PutRolePolicyCommand } = require('@aws-sdk/client-iam');
        exports.handler = async (event) => {
          console.log(JSON.stringify({ msg: 'kill-switch fired', event }));
          await new IAMClient({}).send(new PutRolePolicyCommand({
            RoleName: process.env.WEB_ROLE, PolicyName: 'ai-kill-switch',
            PolicyDocument: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Deny', Action: ['bedrock:InvokeModel', 'bedrock-mantle:CreateInference'], Resource: '*' }] }),
          }));
          await new SSMClient({}).send(new PutParameterCommand({ Name: process.env.PARAM, Value: 'false', Type: 'String', Overwrite: true }));
          await new LambdaClient({}).send(new PutFunctionConcurrencyCommand({ FunctionName: process.env.WORKER, ReservedConcurrentExecutions: 0 }));
        };`),
    });
    aiEnabledParam.grantWrite(killSwitch);
    killSwitch.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:PutRolePolicy'],
      resources: [web.role!.roleArn],
    }));
    killSwitch.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:PutFunctionConcurrency'],
      resources: [aiWorker.functionArn],
    }));
    // Separate topic so ordinary alarms don't trip the kill switch.
    const killTopic = new sns.Topic(this, 'KillSwitchTopic', { displayName: `NutritionDictionary ${props.stage} AI kill switch` });
    killTopic.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['sns:Publish'],
      principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
      resources: [killTopic.topicArn],
    }));
    killTopic.addSubscription(new subs.LambdaSubscription(killSwitch));
    if (props.alertEmail) killTopic.addSubscription(new subs.EmailSubscription(props.alertEmail));

    // ------------------------------------------------------------ alarms (≤10 free)
    const alarm = (id: string, metric: cw.IMetric, threshold: number, periods = 1) =>
      new cw.Alarm(this, id, {
        alarmName: `nutrition-dictionary-${props.stage}-${id}`,
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
    // At 80% of the daily AI cap. The app doesn't emit this metric yet (it logs
    // "[ai] ... cost_usd=" lines instead), so this alarm stays quiet until it does
    // (TODO.md). The budget below is the backstop that works today.
    alarm('AiSpendDaily', new cw.Metric({
      namespace: 'NutritionDictionary', metricName: 'AiSpendMicroUsd',
      dimensionsMap: { Stage: props.stage }, statistic: 'Sum', period: Duration.days(1),
    }), Math.round(props.aiDailyBudgetUsd * 0.8 * 1_000_000));

    // ---------------------------------------------------------------- budget
    // Whole-account cost (includes Claude's AWS Marketplace charges). Budgets data lags by
    // hours, so the 150% kill switch is a backstop, not a real-time cap.
    const percent = (threshold: number, topic: sns.ITopic) => ({
      notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold, thresholdType: 'PERCENTAGE' },
      subscribers: [{ subscriptionType: 'SNS', address: topic.topicArn }],
    });
    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `nutrition-dictionary-${props.stage}-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: props.monthlyBudgetUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        percent(80, alerts),     // email
        percent(100, alerts),    // email
        percent(150, killTopic), // AI off (and an email from the kill-switch topic)
      ],
    });

    // --------------------------------------------------------------- outputs
    new CfnOutput(this, 'SiteUrl', { value: siteUrl });
    new CfnOutput(this, 'CloudFrontUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'StripeWebhookEndpoint', {
      description: 'Register this URL in Stripe (Developers -> Webhooks)',
      value: `${siteUrl}/api/stripe/webhook`,
    });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    new CfnOutput(this, 'WebFunctionName', { value: web.functionName });
    new CfnOutput(this, 'WebLogGroup', { value: webLogs.logGroupName });
    new CfnOutput(this, 'WebRoleName', { value: web.role!.roleName });
    new CfnOutput(this, 'AiWorkerName', { value: aiWorker.functionName });
    new CfnOutput(this, 'AiEnabledParam', { value: aiEnabledParam.parameterName });
    new CfnOutput(this, 'AlertsTopicArn', { value: alerts.topicArn });
    new CfnOutput(this, 'KillSwitchTopicArn', { value: killTopic.topicArn });
  }
}

/** An AWS managed rule group, counted as one rule against the plan's five. */
function managedRule(name: string, priority: number): wafv2.CfnWebACL.RuleProperty {
  return {
    name,
    priority,
    overrideAction: { none: {} },
    statement: { managedRuleGroupStatement: { vendorName: 'AWS', name: `AWSManagedRules${name}` } },
    visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: name, sampledRequestsEnabled: true },
  };
}

/** CloudFront Function (JS 2.0): 301 any of `from` hosts to https://<to> with the same path and query. */
export function redirectFunctionCode(from: string[], to: string): string {
  return `
var FROM = ${JSON.stringify(from.map(h => h.toLowerCase()))};
var TO = ${JSON.stringify(to)};
function handler(event) {
  var request = event.request;
  var host = request.headers.host ? request.headers.host.value.toLowerCase() : '';
  if (FROM.indexOf(host) === -1) return request;
  var parts = [];
  for (var key in request.querystring) {
    var q = request.querystring[key];
    var values = q.multiValue ? q.multiValue : [q];
    for (var i = 0; i < values.length; i++) parts.push(values[i].value === '' ? key : key + '=' + values[i].value);
  }
  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: {
      location: { value: 'https://' + TO + request.uri + (parts.length ? '?' + parts.join('&') : '') },
      'cache-control': { value: 'max-age=86400' },
    },
  };
}
`;
}
