#!/usr/bin/env node
/**
 * EXAMPLE (synth-tested, never deployed). The owner's runbook is docs/DEPLOY.md.
 *
 * Three stacks per stage, each stage in its own AWS account (us-east-1):
 *   NutritionDictionaryDns-<stage>  Route 53 hosted zone + SES domain identity (DKIM, MAIL FROM, DMARC)
 *   NutritionDictionary-<stage>     the site: CloudFront, Lambda, DynamoDB, alarms, budget, kill switch
 *   GithubOidc-<stage>              the role GitHub Actions deploys with (OIDC, no stored keys)
 *
 * Usage (from this cdk/ folder, signed in to the stage's account):
 *   export ALERT_EMAIL='<your email>'                                    # or -c alertEmail=...
 *   npx cdk deploy -c stage=dev  NutritionDictionaryDns-dev              # first, then point DNS at it
 *   npx cdk deploy -c stage=dev  NutritionDictionary-dev                 # deploys the Dns stack too
 *   npx cdk deploy -c stage=prod GithubOidc-prod
 *
 * Context (-c key=value, or the "context" block of cdk.json):
 *   stage           dev | prod (default dev)
 *   alertEmail      where alarms and budget alerts go. Required; ALERT_EMAIL works too. Never commit it.
 *   flatRatePlan    true (default) subscribes the distribution to the CloudFront flat-rate Free plan
 *                   with its WAF web ACL. false = pay-as-you-go CloudFront and no WAF.
 *   devNameServers  prod only: the dev zone's 4 nameservers (comma-separated or a JSON list), so the
 *                   prod zone delegates dev.nutritiondictionary.com to the dev account. Not secret.
 *   synthOnly       true lets CI synthesize without an alert email. Never deploy a synthOnly template.
 */
import { App, Stack, StackProps, Duration, Annotations, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NutritionDictionaryStack } from '../lib/nutrition-dictionary-stack';
import { DnsStack } from '../lib/dns-stack';

const APEX_DOMAIN = 'nutritiondictionary.com';
const GITHUB_REPO = 'yonaadug/FoodNutritionOptimize';

const app = new App();
const stage = String(app.node.tryGetContext('stage') ?? 'dev');
if (stage !== 'dev' && stage !== 'prod') throw new Error(`-c stage must be dev or prod, not "${stage}"`);
const isProd = stage === 'prod';
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' };

const flag = (key: string, fallback: boolean) => {
  const v = app.node.tryGetContext(key);
  return v === undefined ? fallback : v === true || String(v).toLowerCase() === 'true';
};
const list = (key: string): string[] => {
  const v = app.node.tryGetContext(key);
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean);
  const s = String(v).trim();
  return (s.startsWith('[') ? (JSON.parse(s) as string[]) : s.split(',')).map(x => x.trim()).filter(Boolean);
};

// ---------------------------------------------------------------- alert email
// Comes from the deploy command or the environment, never from the repo.
const synthOnly = flag('synthOnly', false);
const alertEmail = String(app.node.tryGetContext('alertEmail') ?? process.env.ALERT_EMAIL ?? '').trim();
if (!alertEmail && !synthOnly) {
  throw new Error(
    'No alert email. Pass -c alertEmail=<address> or set ALERT_EMAIL. ' +
    'Alarms, budget alerts and the kill switch all email it (docs/DEPLOY.md, "Alert email"). ' +
    'In GitHub Actions it comes from the ALERT_EMAIL environment secret.',
  );
}
if (alertEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alertEmail)) {
  throw new Error('The alert email does not look like an email address. Check -c alertEmail / ALERT_EMAIL.');
}

// --------------------------------------------------------------------- domain
// prod: nutritiondictionary.com (+ www, redirected to the apex).
// dev:  dev.nutritiondictionary.com, a zone in the dev account that the prod zone delegates to.
const zoneName = isProd ? APEX_DOMAIN : `dev.${APEX_DOMAIN}`;
const siteDomain = zoneName;
const redirectDomains = isProd ? [`www.${APEX_DOMAIN}`] : [];

const dns = new DnsStack(app, `NutritionDictionaryDns-${stage}`, {
  env,
  stage,
  zoneName,
  delegations: isProd ? { dev: list('devNameServers') } : {},
});

const site = new NutritionDictionaryStack(app, `NutritionDictionary-${stage}`, {
  env,
  stage,
  zone: dns.zone,
  siteDomain,
  redirectDomains,
  emailIdentityName: dns.emailIdentityName,
  // The prod sender is the decision in docs/DECISIONS.md. Dev sends from its own subdomain,
  // because an SES identity belongs to one account.
  emailFrom: isProd
    ? `NutritionDictionary <no-reply@${APEX_DOMAIN}>`
    : `NutritionDictionary dev <no-reply@${zoneName}>`,
  alertEmail: alertEmail || undefined,
  monthlyBudgetUsd: isProd ? 10 : 5,
  aiDailyBudgetUsd: isProd ? 5 : 1,
  flatRatePlan: flag('flatRatePlan', true),
});
if (synthOnly) {
  Annotations.of(site).addWarning('synthOnly: no alert email is subscribed. Do not deploy this template.');
}

/**
 * One-time per account: GitHub Actions OIDC provider + deploy role.
 * The role can ONLY assume the CDK bootstrap roles (cdk-*), and only from this repo's
 * `dev` or `production` GitHub Environment. No long-lived AWS keys anywhere.
 */
class GithubOidcStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { repo: string; environment: string }) {
    super(scope, id, props);
    const provider = new iam.OpenIdConnectProvider(this, 'GithubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });
    const role = new iam.Role(this, 'GithubDeployRole', {
      roleName: `github-deploy-${props.environment}`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `repo:${props.repo}:environment:${props.environment}`,
        },
      }),
    });
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
    }));
    new CfnOutput(this, 'DeployRoleArn', {
      description: `GitHub: Settings -> Environments -> ${props.environment} -> variable AWS_DEPLOY_ROLE_ARN`,
      value: role.roleArn,
    });
  }
}
new GithubOidcStack(app, `GithubOidc-${stage}`, {
  env,
  repo: GITHUB_REPO,
  environment: isProd ? 'production' : 'dev',
});
