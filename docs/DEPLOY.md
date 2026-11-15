# Deploying NutritionDictionary to AWS

A step-by-step runbook, from no AWS setup to a live site at **https://nutritiondictionary.com**. It follows the owner's decisions in [DECISIONS.md](DECISIONS.md). Each step says where to click or what to run, how to check it worked, and what it costs.

**Status (2026-11-14):** written against the CDK example in [`aws/infra-example/`](aws/infra-example/), which type-checks and synthesizes for dev and prod but **has never been deployed**. Expect to fix small things on the first dev deploy. That's what dev is for.

## Before you start

**Time:** about a day of clicking and waiting, spread over a few days, because some steps wait on other people: DNS (minutes to hours), SES production access (about a day), Google's consent screen, and the Bedrock quota for Claude (days).

**Open items that block a working launch** (code, not AWS):

| Item | Effect until it's fixed | Owner |
|---|---|---|
| ~~**Browser POSTs need an `x-amz-content-sha256` header.**~~ Fixed on 2026-11-14: every browser request body goes through `sameOriginFetch` (`lib/same-origin-fetch.ts`), photos go up as raw bytes so they can be hashed, and a test fails the build if any browser code sends a body with plain `fetch()`. The smoke test sends the header too | None | Done |
| **Privacy policy and terms** at `/privacy`, `/health-data-privacy` and `/terms` | Drafted, with consent recorded at sign-in. Fill the placeholders in `lib/legal.ts` and get a lawyer's review ([LEGAL.md](LEGAL.md)) before turning off `LEGAL_DRAFT` | You |
| **Stripe webhook route** `app/api/stripe/webhook` | Plus can't be bought yet. The infrastructure for it is ready | Being built |

**Conventions in this guide**

- Commands are for **bash or zsh**. Your Terminal runs fish, which can't run some of them, so type `bash` first and run them there.
- `<DEV_ACCOUNT_ID>` and similar are placeholders. Replace the whole thing, brackets included.
- AWS work is all in **us-east-1 (N. Virginia)**. Check the region menu at the top right of the console every time.
- Paths are relative to the repository root (the `FoodNutritionOptimize` folder). Steps that need another folder start with a `cd` from the root. "The CDK folder" is `docs/aws/infra-example/cdk`.
- `export ALERT_EMAIL=...` (step 6) lasts only for that terminal window. Run it again in each new terminal before any `npx cdk` command.

**What you'll end up with**

```
AWS Organization (management account: billing and sign-in only)
├── nutrition-dictionary-dev    dev.nutritiondictionary.com   every push to main
└── nutrition-dictionary-prod   nutritiondictionary.com       after you approve in GitHub
```

Each stage account has three CloudFormation stacks, made by the CDK app:

| Stack | What's in it |
|---|---|
| `NutritionDictionaryDns-<stage>` | Route 53 hosted zone, SES email identity (DKIM, MAIL FROM, DMARC records) |
| `NutritionDictionary-<stage>` | CloudFront (flat-rate Free plan, firewall, certificate), the web Lambda, the Stripe-webhook Lambda, DynamoDB, uploads bucket, imports queue and worker, alarms, the budget, the AI kill switch |
| `GithubOidc-<stage>` | The role GitHub Actions deploys with. No AWS keys are stored anywhere |

**Running cost at launch:** the domain ($11.81/yr) plus a few cents a month, as long as traffic stays inside the free tiers (about 6,000 monthly users for CloudFront's Free plan). AI is the only cost that grows quickly, and it's capped. The table is at the end: [What it costs](#what-it-costs).

---

## Part 1: Accounts and tools

### 1. Install the tools

**Cost:** free.

1. **AWS CLI.** The `aws` in `/usr/local/bin` is an Intel build that fails on this Mac ("bad CPU type in executable"). Install the native one and remove the old one:
   ```bash
   brew install awscli
   which -a aws                      # if /usr/local/bin/aws is listed first:
   sudo rm -f /usr/local/bin/aws /usr/local/bin/aws_completer && sudo rm -rf /usr/local/aws-cli
   hash -r
   aws --version                     # should mention arm64 / aarch64
   ```
2. **Node.** The repo wants Node 24 or newer (`.nvmrc` says 26). Check with `node --version`. If it's older: `brew install node`.
3. **The CDK.** Nothing to install globally. The CDK folder pins its own version:
   ```bash
   cd docs/aws/infra-example/cdk
   npm ci
   npx cdk --version                 # 2.1147.0 (or whatever package.json pins)
   ```
4. **Git LFS**, if you haven't already: `brew install git-lfs && git lfs install && git lfs pull`. The nutrition database is an LFS file, and the deploy builds it into the image.

Docker is **not** needed on your laptop. GitHub Actions builds the image.

**Check:** `aws --version`, `node --version` and `npx cdk --version` all print versions without errors.

### 2. Create the AWS Organization and the two accounts

**Cost:** free. Organizations, IAM Identity Center and extra accounts cost nothing.

The AWS account you've used so far (where Nova was tested) becomes the **management account**. It holds billing and sign-in only, never the site. Two new member accounts hold dev and prod.

1. Sign in to the [AWS console](https://console.aws.amazon.com/) as the **root user** of your existing account.
2. **Protect the root user:** top right, your account name → **Security credentials** → **Multi-factor authentication (MFA)** → **Assign MFA device**. A passkey or an authenticator app both work. Store the recovery details somewhere safe.
3. **Paid plan:** if the console shows a banner saying the account is on the AWS **Free plan**, choose **Upgrade to Paid plan**. Your credits are kept. Organizations and CloudFront's flat-rate plans both need a Paid-plan account.
4. **Create the organization:** search for **AWS Organizations** → **Create an organization**. Confirm the verification email AWS sends.
5. **Add the two accounts:** in Organizations, **AWS accounts** → **Add an AWS account** → **Create an AWS account**, twice:

   | Account name | Email address |
   |---|---|
   | `nutrition-dictionary-dev` | your Gmail address with `+nd-dev` added just before the `@` (Gmail delivers these "plus addresses" to your normal inbox) |
   | `nutrition-dictionary-prod` | the same with `+nd-prod` |

   Each account needs an email address no other AWS account uses. Leave the IAM role name as `OrganizationAccountAccessRole`.
6. **Turn off root sign-in for the new accounts:** IAM → **Root access management** → **Enable** (both options). Member accounts then have no root password at all, so there's no root MFA to manage for them. You can still recover them from the management account.
7. **Cost Anomaly Detection (free):** in the management account, **Billing and Cost Management** → **Cost Anomaly Detection** → create the default **AWS services** monitor with a daily email summary to your address.

**Check:** Organizations → AWS accounts lists three accounts, all **Active**. Write down the two new 12-digit account IDs. They're `<DEV_ACCOUNT_ID>` and `<PROD_ACCOUNT_ID>` below.

### 3. Set up IAM Identity Center for everyday sign-in

**Cost:** free.

You'll stop using the root user. Day to day you sign in through Identity Center, which gives short-lived credentials to both the console and the CLI.

1. In the management account (region **us-east-1**), search for **IAM Identity Center** → **Enable** → **Enable with AWS Organizations**.
2. **Users** → **Add user**: your name and your usual email. Accept the invitation email, set a password, and register MFA when asked.
3. **Permission sets** → **Create permission set** → **Predefined** → **AdministratorAccess**, session duration 4 hours.
4. **AWS accounts** → tick `nutrition-dictionary-dev` and `nutrition-dictionary-prod` → **Assign users or groups** → your user → **AdministratorAccess**. (Optionally also the management account, for billing.)
5. On the Identity Center **Dashboard**, copy the **AWS access portal URL** (like `https://d-xxxxxxxxxx.awsapps.com/start`).
6. Connect the CLI, once per account:
   ```bash
   aws configure sso
   # SSO session name: nd
   # SSO start URL: <the portal URL>
   # SSO region: us-east-1
   # SSO registration scopes: (press Enter)
   # A browser opens: approve. Then pick the dev account and AdministratorAccess.
   # Default client Region: us-east-1    Default output format: json
   # Profile name: nd-dev
   aws configure sso                  # again, same session name "nd": pick the prod account, profile name nd-prod
   ```
7. Each morning (sessions expire): `aws sso login --sso-session nd`.

**Check:**
```bash
aws sts get-caller-identity --profile nd-dev     # Account = <DEV_ACCOUNT_ID>
aws sts get-caller-identity --profile nd-prod    # Account = <PROD_ACCOUNT_ID>
```

### 4. Raise the Lambda concurrency limit in both accounts

**Cost:** free.

The stack reserves concurrency to cap how fast money can be spent (web 25 in prod, 5 in dev, plus 2 for the worker and a few for the webhook). AWS must keep 100 unreserved, and new accounts often start with a total of only 10, so the first deploy fails with "Specified ReservedConcurrentExecutions ... decreases account's UnreservedConcurrentExecution below its minimum value".

```bash
aws lambda get-account-settings --profile nd-dev --query 'AccountLimit.ConcurrentExecutions'
aws lambda get-account-settings --profile nd-prod --query 'AccountLimit.ConcurrentExecutions'
```

If either says less than 1000, request 1000:
```bash
aws service-quotas request-service-quota-increase --profile nd-dev \
  --service-code lambda --quota-code L-B99A9384 --desired-value 1000
aws service-quotas request-service-quota-increase --profile nd-prod \
  --service-code lambda --quota-code L-B99A9384 --desired-value 1000
```

**Check:** the same `get-account-settings` command prints 1000. It usually takes minutes to a day. You can carry on with the next steps meanwhile; only step 14 needs it.

---

## Part 2: Domain and DNS

### 5. Buy nutritiondictionary.com at Porkbun

**Cost:** $11.81 per year (first year and renewals, checked 2026-11-14).

1. At [porkbun.com](https://porkbun.com), search for `nutritiondictionary.com` and buy it. WHOIS privacy is included for free.
2. Turn **auto-renew** on (Account → Domain Management → the domain → Auto Renew).
3. Don't change the nameservers yet. You'll get the right ones in step 7.

**Check:** the domain appears in Porkbun's Domain Management list.

### 6. Bootstrap the CDK in both accounts, and create the GitHub deploy roles

**Cost:** a few cents a month (an S3 bucket and an ECR repository for build artifacts).

Every CDK command synthesizes the whole app, which needs the alert email. Set it in your shell first. It's the address that gets alarms and budget warnings. It's never committed to the repo.

```bash
cd docs/aws/infra-example/cdk
export ALERT_EMAIL='<your usual email>'

npx cdk bootstrap aws://<DEV_ACCOUNT_ID>/us-east-1 --profile nd-dev
npx cdk bootstrap aws://<PROD_ACCOUNT_ID>/us-east-1 --profile nd-prod

npx cdk deploy GithubOidc-dev  -c stage=dev  --profile nd-dev
npx cdk deploy GithubOidc-prod -c stage=prod --profile nd-prod
```

Each `GithubOidc` deploy prints a **DeployRoleArn** output, like `arn:aws:iam::<DEV_ACCOUNT_ID>:role/github-deploy-dev`. Keep both for step 13. The dev role only trusts this repo's `dev` GitHub environment, and the prod role only trusts `production`.

Then stop old images piling up in the bootstrap's container repository (each deploy pushes a ~300 MB image, at $0.10/GB-month):
```bash
POLICY='{"rules":[{"rulePriority":1,"description":"keep the last 10 images","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":10},"action":{"type":"expire"}}]}'
aws ecr put-lifecycle-policy --profile nd-dev  --repository-name cdk-hnb659fds-container-assets-<DEV_ACCOUNT_ID>-us-east-1  --lifecycle-policy-text "$POLICY"
aws ecr put-lifecycle-policy --profile nd-prod --repository-name cdk-hnb659fds-container-assets-<PROD_ACCOUNT_ID>-us-east-1 --lifecycle-policy-text "$POLICY"
```

**Check:** CloudFormation in each account (console, us-east-1) shows `CDKToolkit` and `GithubOidc-<stage>` as **CREATE_COMPLETE**.

### 7. Create the prod DNS zone and point Porkbun at it

**Cost:** $0.50/month for the hosted zone, which the CloudFront Free plan covers once the prod deploy (step 16) attaches it.

```bash
npx cdk deploy NutritionDictionaryDns-prod -c stage=prod --profile nd-prod
```

This creates the Route 53 zone for `nutritiondictionary.com`, and the SES identity whose DKIM and MAIL FROM records go straight into that zone. It prints **NameServers**: four names like `ns-123.awsdns-45.com`.

In Porkbun: **Domain Management** → `nutritiondictionary.com` → **Details** → **Authoritative Nameservers** → **Edit**. Delete Porkbun's entries, paste the four AWS names (one per line, no trailing dot), and save.

**Check** (from minutes to a few hours; rarely up to 48):
```bash
dig NS nutritiondictionary.com +short     # the four awsdns names
```

### 8. Create the dev zone and delegate dev.nutritiondictionary.com to it

**Cost:** $0.50/month (covered by the dev distribution's Free plan after step 14).

The dev site lives at `dev.nutritiondictionary.com`, in a zone in the dev account. The prod zone hands that name over with an NS record.

```bash
npx cdk deploy NutritionDictionaryDns-dev -c stage=dev --profile nd-dev
```

Copy its four **NameServers** into `cdk.json` in the CDK folder, replacing the empty `"devNameServers": []` line in the `context` block (use your four names, not these):
```json
"devNameServers": ["ns-1.awsdns-01.org", "ns-2.awsdns-02.com", "ns-3.awsdns-03.net", "ns-4.awsdns-04.co.uk"]
```
Nameservers aren't secret. **Commit this change.** Every prod deploy rebuilds the prod DNS stack from `cdk.json`, so without the commit the next deploy would remove the delegation. Then add the record:

```bash
npx cdk deploy NutritionDictionaryDns-prod -c stage=prod --profile nd-prod
```

**Check:**
```bash
dig NS dev.nutritiondictionary.com +short       # the dev zone's four names
```

### 9. SES: confirm the domains, and get ready to email

**Cost:** $0.10 per 1,000 emails. Nothing for the identities themselves.

The DNS stacks already published the DKIM records, so verification finishes by itself once DNS resolves.

1. In each account: **Amazon SES** → **Identities**. `nutritiondictionary.com` (prod) or `dev.nutritiondictionary.com` (dev) should show **Identity status: Verified**, and under **Authentication**, **DKIM: Successful** and **Custom MAIL FROM domain: Successful**. This can take up to 72 hours, but usually takes minutes once step 7 or 8 checks out.
2. **Dev stays in the SES sandbox** permanently. In the sandbox, SES only delivers to addresses you've verified. In the **dev** account: **Identities** → **Create identity** → **Email address** → your usual address → open the email AWS sends and click the link. Do the same for any other inbox you want to test with.
3. **Prod needs production access**, so that anyone can receive a sign-in link. Request it once the prod site and its privacy page are online (step 17), because AWS reviews the website.

**Check:** both domain identities say **Verified**.

---

## Part 3: Secrets and sign-in

### 10. Create the sign-in secret in each account

**Cost:** free (SSM Parameter Store, standard tier).

The app signs session cookies with `AUTH_SECRET`. It's stored as an SSM **SecureString**, and the Lambda reads it at start-up ([`lambda-secrets/start.mjs`](aws/infra-example/lambda-secrets/start.mjs)). It never appears in the code, in GitHub or in the Lambda console. Use a different secret per stage.

```bash
aws ssm put-parameter --profile nd-dev  --type SecureString \
  --name /nutrition-dictionary/dev/auth/secret  --value "$(openssl rand -base64 32)"
aws ssm put-parameter --profile nd-prod --type SecureString \
  --name /nutrition-dictionary/prod/auth/secret --value "$(openssl rand -base64 32)"
```

`openssl rand -base64 32` makes 44 random characters; the app needs at least 32. You never need to see the value.

**Every parameter the stack reads** (`<stage>` is `dev` or `prod`). All are SecureString. A missing one turns its feature off, and the log says which:

| Parameter | Becomes | Needed for | Created in |
|---|---|---|---|
| `/nutrition-dictionary/<stage>/auth/secret` | `AUTH_SECRET` | any sign-in | this step |
| `/nutrition-dictionary/<stage>/auth/google-client-id` | `GOOGLE_CLIENT_ID` | the Google button | step 11 |
| `/nutrition-dictionary/<stage>/auth/google-client-secret` | `GOOGLE_CLIENT_SECRET` | the Google button | step 11 |
| `/nutrition-dictionary/<stage>/stripe/secret-key` | `STRIPE_TEST_SECRET_KEY` (dev) / `STRIPE_SECRET_KEY` (prod) | Plus checkout | when Plus ships ([STRIPE_PLAN.md](STRIPE_PLAN.md)) |
| `/nutrition-dictionary/<stage>/stripe/webhook-secret` | `STRIPE_TEST_WEBHOOK_SECRET` / `STRIPE_WEBHOOK_SECRET` | Stripe webhooks | when Plus ships |

Dev runs Stripe in test mode (`STRIPE_MODE=test`, sandbox keys) and prod in live mode.

**Check:**
```bash
aws ssm describe-parameters --profile nd-dev --query 'Parameters[].[Name,Type]' --output table
```

**Changing a secret later:** run the same `put-parameter` with `--overwrite`, then make Lambda start fresh copies: `aws lambda update-function-configuration --profile nd-<stage> --function-name <WebFunctionName> --description "secrets $(date +%s)"`. Changing `AUTH_SECRET` signs everyone out.

### 11. Set up Google sign-in

**Cost:** free.

You need one Google Cloud project with an OAuth consent screen, and two OAuth clients (dev and prod), so each account holds only its own keys.

1. Open [console.cloud.google.com](https://console.cloud.google.com), sign in with the Google account that should own this, and **create a project** named `NutritionDictionary`.
2. Go to **Google Auth Platform** (search "OAuth consent") → **Get started**:
   - **App information:** app name `NutritionDictionary`, user support email (yours).
   - **Audience:** **External**.
   - **Contact information:** your email. Agree to the policy and **Create**.
3. **Branding:**
   - **App domain:** home page `https://nutritiondictionary.com`, privacy policy `https://nutritiondictionary.com/privacy`, terms of service `https://nutritiondictionary.com/terms`. The privacy and terms pages are being built; publish the app (step 5 here) once they're live.
   - **Authorized domains:** `nutritiondictionary.com` (this covers `dev.` too).
   - Skip the logo for now. A logo means Google reviews the app's branding first.
4. **Data access:** add the scopes `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`. That's all Better Auth asks for. They're "non-sensitive", so no security review is needed.
5. **Audience** → **Publish app** (status **In production**). Until then only listed test users can sign in. Do this when `/privacy` is live.
6. **Clients** → **Create client** → **Web application**, twice:

   | Name | Authorized JavaScript origins | Authorized redirect URIs |
   |---|---|---|
   | `NutritionDictionary prod` | `https://nutritiondictionary.com` | `https://nutritiondictionary.com/api/auth/callback/google` |
   | `NutritionDictionary dev` | `https://dev.nutritiondictionary.com` and `http://localhost:3000` | `https://dev.nutritiondictionary.com/api/auth/callback/google` and `http://localhost:3000/api/auth/callback/google` |

   The callback path is Better Auth's: `basePath: '/api/auth'` in `lib/auth/auth.ts`, plus `/callback/google`. `www.` isn't needed, because it redirects to the apex before anyone signs in. The `localhost` entries let you test Google sign-in from `npm run dev`.
7. After each client is created, Google shows its **Client ID** and **Client secret**. Store them without leaving the secret in your shell history:
   ```bash
   read -r  GID   && aws ssm put-parameter --profile nd-dev --type SecureString --name /nutrition-dictionary/dev/auth/google-client-id     --value "$GID"
   read -rs GSEC  && aws ssm put-parameter --profile nd-dev --type SecureString --name /nutrition-dictionary/dev/auth/google-client-secret --value "$GSEC"
   unset GID GSEC
   ```
   (`read` waits for you to paste and press Enter; `-s` hides what you paste.) Repeat with `nd-prod` and `/nutrition-dictionary/prod/...` for the prod client.

**Check:** `aws ssm describe-parameters --profile nd-dev` lists the three `auth/` parameters. The **Continue with Google** button appears on the site's sign-in page after the next deploy (or the next cold start).

### 12. Bedrock (recipe AI)

**Cost:** pay per use. Each running copy of the app stops calling AI after $5 of estimated spend a day (`AI_DAILY_BUDGET_USD`), and the budget's kill switch is the account-wide backstop. About $0.00025 per Gemma photo read ([BEDROCK_SETUP.md §3](BEDROCK_SETUP.md#3-which-model-to-use)).

- **Since 2026-11-15 the site reads recipes with Gemma 3 27B, falling back to Nova Lite v1. Both work without any setup.** They need no form, agreement or quota request, and the stack grants exactly these two (Gemma's foundation-model ARN; Nova Lite's `us.` profile and its three regions' foundation-model ARNs).
- **Claude isn't used, so the Claude account steps aren't needed**, in either account. The pending Claude quota requests can be withdrawn or left. To switch back to Claude later, see [BEDROCK_SETUP.md §2 and §5](BEDROCK_SETUP.md#2-fix-the-account-owner-actions): the account steps in that account, then the stack's `AI_*` models and grants.

**Check:** `aws bedrock get-foundation-model-availability --profile nd-prod --model-id google.gemma-3-27b-it` shows `agreementAvailability.status: AVAILABLE` and `authorizationStatus: AUTHORIZED`.

---

## Part 4: GitHub and the first deploys

### 13. Configure GitHub environments

**Cost:** free for a public repository. **Required reviewers on a private repository need GitHub Pro** ($4/month), so either make the repo public or upgrade.

In the repository on GitHub: **Settings** → **Environments**:

1. **New environment** `dev`:
   - **Environment variables** → **Add variable**: `AWS_DEPLOY_ROLE_ARN` = the dev DeployRoleArn from step 6.
   - **Environment secrets** → **Add secret**: `ALERT_EMAIL` = your usual email. It's a secret so it's masked in logs.
2. **New environment** `production`:
   - **Required reviewers:** tick it and add yourself. Leave **Prevent self-review** unticked, or nobody can approve your own pushes.
   - **Deployment branches and tags:** **Selected branches** → add `main`.
   - Variable `AWS_DEPLOY_ROLE_ARN` = the prod DeployRoleArn. Secret `ALERT_EMAIL` = your email.

The environment names must be exactly `dev` and `production`: the AWS roles only trust those.

**Check:** Settings → Environments lists `dev` and `production`, and `production` shows "1 protection rule".

### 14. First dev deploy

**Cost:** a few cents (build minutes are free on public repos; the Lambda, DynamoDB and CloudFront free tiers cover a test).

1. Copy the workflow into place and push:
   ```bash
   cp docs/aws/infra-example/github-actions/deploy.yml .github/workflows/deploy.yml
   git add .github/workflows/deploy.yml
   git commit -m "Deploy to AWS from GitHub Actions"
   git push
   ```
   From now on, every push to `main` deploys dev, then waits for your approval before prod.
2. Watch **Actions** → **deploy**. The first run takes 15 to 30 minutes: the image build, then CloudFront (5 to 15 minutes), the certificate (a few minutes, validated through DNS), and the Free-plan subscription. The prod job waits for approval; leave it for now.
3. **Confirm the alert emails.** AWS sends two "AWS Notification - Subscription Confirmation" emails (alerts and kill switch) to `ALERT_EMAIL`. Click **Confirm subscription** in both. Until you do, alarms and budget warnings go nowhere.

**If the deploy fails:** the job log shows the CloudFormation error, and CloudFormation rolls back by itself. The usual first-time causes:

| Error mentions | Fix |
|---|---|
| `UnreservedConcurrentExecution below its minimum` | Step 4 isn't finished |
| `FlatRatePlan` or `PricingPlanManager` | Set `"flatRatePlan": false` in `cdk.json` context, push, and subscribe the distribution to the Free plan by hand later (CloudFront → the distribution → **Manage plan**). Without the plan there's no firewall, and CloudFront is billed pay-as-you-go (still about $0 at low traffic) |
| The certificate waits a long time | `dig NS dev.nutritiondictionary.com` doesn't return the dev zone yet (step 8) |
| `ALERT_EMAIL` or `AWS_DEPLOY_ROLE_ARN` | Step 13 |
| `Not authorized to perform sts:AssumeRoleWithWebIdentity` | The environment name or the repository in `bin/nutrition-dictionary.ts` (`GITHUB_REPO`) doesn't match |

**Check:** the `deploy-dev` job is green and https://dev.nutritiondictionary.com opens the site.

### 15. Test dev

Look up the stack's outputs (function names, topics) whenever a command below needs one:
```bash
aws cloudformation describe-stacks --profile nd-dev --stack-name NutritionDictionary-dev \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table
```

1. **Smoke test** (the workflow runs it too):
   ```bash
   cd food-nutrition-app
   npm run smoke -- https://dev.nutritiondictionary.com
   ```
   Every line should say `ok`. The `POST /api/optimize` check fails until the first open item in [Before you start](#before-you-start) is fixed.
2. **Secrets loaded:**
   ```bash
   aws logs tail <WebLogGroup> --profile nd-dev --since 1h | grep '\[secrets\]'
   ```
   Expect `[secrets] loaded AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET from SSM`. A "does not exist yet" line names any parameter you haven't created.
3. **Sign in with email:** on the dev site press **Sign in**, enter the address you verified in step 9, open the email, press **Sign in**. Then open a food page and check it appears on `/account`. Sign out.
4. **Sign in with Google:** press **Continue with Google** and finish the flow.
5. **Rate limits see real IPs:** in the logs, there should be no Better Auth warning about a missing IP address:
   ```bash
   aws logs tail <WebLogGroup> --profile nd-dev --since 1h | grep -i 'ip address'
   ```
   No output is good. A warning means `CloudFront-Viewer-Address` isn't arriving, and everyone shares one sign-in limit ([ACCOUNTS.md](ACCOUNTS.md#going-to-production-on-aws)).
6. **A Bedrock read.** First check the account can call Gemma at all (costs a fraction of a cent):
   ```bash
   aws bedrock-runtime converse --profile nd-dev --model-id google.gemma-3-27b-it \
     --messages '[{"role":"user","content":[{"text":"Reply with OK"}]}]' \
     --inference-config maxTokens=20 --query 'output.message.content[0].text'
   ```
   Then through the site, once the first open item in [Before you start](#before-you-start) is fixed (the recipe reader's upload is a POST): on `/recipes`, upload a photo of a recipe (pasted text the built-in reader is sure of never reaches AI), and check the log:
   ```bash
   aws logs tail <WebLogGroup> --profile nd-dev --since 15m | grep '\[ai\]'
   ```
   Expect a line like `[ai] provider=bedrock model=google.gemma-3-27b-it kind=image ... ok=true ... cost_usd=0.00023 tokens=maybe_undercounted`. A line naming `us.amazon.nova-lite-v1:0` means Gemma failed and the fallback read it; the line before says why.
7. **Kill switch, on dev first.** See [Post-launch checklist](#18-post-launch-checklist), item 4. Practise it here, where nothing is at stake.

---

## Part 5: Production

### 16. Deploy prod

**Cost:** see [What it costs](#what-it-costs).

1. In GitHub **Actions**, open the latest **deploy** run. The `deploy-prod` job says **Waiting**. Press **Review deployments** → tick `production` → **Approve and deploy**.
2. It takes 15 to 30 minutes the first time. Confirm the two subscription emails again (prod has its own topics).

**Check:** https://nutritiondictionary.com opens the site, and https://www.nutritiondictionary.com redirects to it:
```bash
curl -sI https://www.nutritiondictionary.com/plan | grep -i '^location'   # https://nutritiondictionary.com/plan
```

### 17. SES production access

**Cost:** free.

Until this is granted, prod can only email verified addresses, so strangers can't sign in with email (Google still works).

In the **prod** account: **Amazon SES** → **Account dashboard** → **Request production access**:

- **Mail type:** Transactional
- **Website URL:** `https://nutritiondictionary.com`
- **Use case description** (edit to taste):

  > NutritionDictionary (https://nutritiondictionary.com) is a nutrition reference website. Accounts are optional and passwordless. The only email we send is a one-time sign-in link, from no-reply@nutritiondictionary.com, when a person types their own address on our sign-in page and asks for one. We send no marketing or bulk email, and use no purchased or imported lists. Links expire after 15 minutes. The app allows at most 5 sign-in emails per address per hour and 10 sign-in requests per IP address per 5 minutes, and shows the same response whether or not an address has an account. Expected volume at launch is under 100 emails a day. The domain has DKIM, SPF (custom MAIL FROM domain) and DMARC. Bounces and complaints are handled by the SES account-level suppression list, so we never retry an address that bounced or complained. People can delete their account and data at any time on the site. Our privacy policy is at https://nutritiondictionary.com/privacy.

- **Additional contacts:** your email. **Preferred contact language:** English.

AWS usually answers within a day. If they ask questions, answer in the case; it's normal.

**Check:** the Account dashboard no longer says "Your account is in the sandbox", and the sending quota is above 200 per day. Then sign in on prod with an address you never verified.

### 18. Post-launch checklist

Do these in prod (after practising 4 on dev):

1. **Alarms email you.** Pick one alarm and force it:
   ```bash
   aws cloudwatch set-alarm-state --profile nd-prod --alarm-name nutrition-dictionary-prod-Web5xx \
     --state-value ALARM --state-reason "testing alert email"
   ```
   An "ALARM" email should arrive within a minute. It returns to OK on its own. Also check that all 8 alarms exist: `aws cloudwatch describe-alarms --profile nd-prod --alarm-name-prefix nutrition-dictionary-prod --query 'MetricAlarms[].[AlarmName,StateValue]' --output table`. (`AiSpendDaily` stays quiet until the app emits its metric, which is on the TODO list. The budget covers AI meanwhile.)
2. **Budget emails can reach you.** Budgets → `nutrition-dictionary-prod-monthly`: $10, alerts at 80% and 100% (to the alerts topic) and 150% (to the kill-switch topic). Then check both topics' subscriptions are confirmed, not pending:
   ```bash
   aws sns list-subscriptions-by-topic --profile nd-prod --topic-arn <AlertsTopicArn> --query 'Subscriptions[].SubscriptionArn'
   aws sns publish --profile nd-prod --topic-arn <AlertsTopicArn> --subject "Budget path test" --message "test"
   ```
   The first should not say `PendingConfirmation`; the second should arrive as an email.
3. **Flat-rate plan and firewall.** CloudFront → the distribution → **Pricing plan** shows **Free**, the **Security** tab shows the web ACL, and the hosted zone is listed under the plan.
4. **Kill-switch test.** This turns AI off exactly as the 150% budget alert would:
   ```bash
   aws sns publish --profile nd-prod --topic-arn <KillSwitchTopicArn> --message "kill switch test"
   ```
   Within a minute you should see:
   - an email from the kill-switch topic;
   - `aws iam get-role-policy --profile nd-prod --role-name <WebRoleName> --policy-name ai-kill-switch` shows a Deny on Bedrock;
   - `aws ssm get-parameter --profile nd-prod --name /nutrition-dictionary/prod/ai-enabled --query Parameter.Value` says `"false"`;
   - on the site, a recipe photo gets "the reader isn't available", while food pages, the planner and pasted text the built-in reader handles keep working (needs the POST fix from [Before you start](#before-you-start)).

   Then [turn AI back on](#turn-ai-back-on).
5. **Data settings.** DynamoDB → `nutrition-dictionary-prod` → **Backups**: point-in-time recovery **On**, 35 days. S3 → the uploads bucket → **Management**: the lifecycle rule expires objects after 1 day. CloudWatch → **Log groups**: retention 14 days on every `NutritionDictionary-prod-*` group.
6. **Sign-in on prod:** an email link to a non-verified inbox (after step 17), Google, export (`/account`), and account deletion with a throwaway address.
7. **Stripe, when Plus ships:** register `https://nutritiondictionary.com/api/stripe/webhook` (the `StripeWebhookEndpoint` output) in Stripe, and create the two `stripe/` parameters (step 10).

### Turn AI back on

After the kill switch (test or real), undo its three changes:
```bash
aws iam delete-role-policy --profile nd-prod --role-name <WebRoleName> --policy-name ai-kill-switch
aws ssm put-parameter --profile nd-prod --name /nutrition-dictionary/prod/ai-enabled --value true --type String --overwrite
aws lambda put-function-concurrency --profile nd-prod --function-name <AiWorkerName> --reserved-concurrent-executions 2
```
A deploy doesn't undo the kill switch: the Deny policy isn't part of the stack, on purpose. If it fired for real, find out why first (Cost Explorer, filtered to the prod account and grouped by service). The 150% alert fires once a month, so if you re-enable while still over budget, nothing will stop AI again this month: raise the budget in `bin/nutrition-dictionary.ts` or watch it.

### Rollback

- **A bad release:** GitHub **Actions** → **deploy** → open the last good run → **Re-run jobs** → `deploy-prod`. A re-run deploys that run's commit. Or `git revert` the bad commit and push, which goes through dev and your approval as usual.
- **A failed deploy** rolls itself back. If CloudFormation ever shows `UPDATE_ROLLBACK_FAILED`, open the stack in the console and choose **Continue update rollback**.
- **Take the site offline in an emergency:** `aws lambda put-function-concurrency --profile nd-prod --function-name <WebFunctionName> --reserved-concurrent-executions 0`. Visitors get an error page. Any deploy restores it (or set it back to 25).
- **Data:** DynamoDB → the table → **Backups** → **Restore to point in time** creates a *new* table from any second in the last 35 days. Pointing the app at it means changing the table name in the stack, so it's a planned job, not a quick switch.
- **Delete a dev stack** to start over: `npx cdk destroy NutritionDictionary-dev -c stage=dev --profile nd-dev`. The prod table and both hosted zones are kept even if their stacks are deleted.

### AWS Activate credits

Apply for [AWS Activate Founders](https://aws.amazon.com/startups/credits) (credits for self-funded startups) with the **management account's** ID, so the credits cover the whole organization. They may not cover Claude, which is billed through AWS Marketplace.

---

## What it costs

Prices from [AWS_HOSTING_DESIGN.md](aws/AWS_HOSTING_DESIGN.md) and the pages linked there, checked 2026-11-03 to 14. Launch traffic is assumed to be well under the free tiers.

| Item | Monthly cost at launch | Notes |
|---|---|---|
| Domain at Porkbun | $0.98 ($11.81/yr) | |
| CloudFront, WAF, Route 53 zones | $0 | Flat-rate Free plan per distribution: 1M requests, 100 GB, 5 firewall rules, no overage charges. Revisit (Pro, $15) at about 6,000 monthly users |
| Lambda | $0 | 1M requests and 400k GB-seconds free per month, per account |
| DynamoDB | ~$0 | On-demand, 25 GB free. PITR in prod is $0.20/GB-month |
| S3 uploads, SQS | ~$0 | Photos are deleted after a day |
| SES | ~$0 | $0.10 per 1,000 sign-in emails |
| CloudWatch | $0 | 8 alarms per account (10 free), 5 GB of logs free, kept 14 days |
| SSM, Budgets, Cost Anomaly Detection, Organizations, Identity Center | $0 | |
| CDK bootstrap (ECR images, S3) | a few cents | With the step 6 lifecycle rule |
| **AI (Bedrock)** | usage | Capped by the app at $5/day in prod ($1 in dev), then by the budget |
| **Budget guardrail** | | Prod $10/month, dev $5. Email at 80% and 100%; at 150% the kill switch turns AI off and the site stays up |
