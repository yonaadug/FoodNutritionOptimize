#!/usr/bin/env node
/**
 * EXAMPLE (synth-tested, never deployed) — see docs/aws/AWS_HOSTING_DESIGN.md §3.11.
 * Usage (from this cdk/ folder, with credentials for the target account):
 *   npx cdk bootstrap aws://<ACCOUNT>/us-east-1
 *   npx cdk deploy -c stage=dev  MicronutrientDiary-dev
 *   npx cdk deploy -c stage=prod MicronutrientDiary-prod GithubOidc-prod   (prod account)
 */
import { App, Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { MicronutrientDiaryStack } from '../lib/micronutrient-diary-stack';

const app = new App();
const stage = (app.node.tryGetContext('stage') ?? 'dev') as 'dev' | 'prod';
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' };

new MicronutrientDiaryStack(app, `MicronutrientDiary-${stage}`, {
  env,
  stage,
  siteUrl: stage === 'prod' ? 'https://micronutrientdiary.com' : 'https://REPLACE_WITH_DEV_CLOUDFRONT_DOMAIN',
  alertEmail: 'REPLACE_ME@example.com',
  monthlyBudgetUsd: stage === 'prod' ? 25 : 5,
  sesDomain: stage === 'prod' ? 'micronutrientdiary.com' : undefined,
});

/**
 * One-time per account: GitHub Actions OIDC provider + deploy role.
 * The role can ONLY assume the CDK bootstrap roles (cdk-*), and only from this repo's
 * `production` (or `dev`) GitHub Environment. No long-lived AWS keys anywhere.
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
    // Read-only access to the nutrition DB artifacts bucket (created separately).
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: ['arn:aws:s3:::REPLACE_ARTIFACTS_BUCKET/nutrition-db/*'],
    }));
  }
}
new GithubOidcStack(app, `GithubOidc-${stage}`, {
  env,
  repo: 'yonaadug/FoodNutritionOptimize',
  environment: stage === 'prod' ? 'production' : 'dev',
});
