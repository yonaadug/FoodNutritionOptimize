# Browser tasks: get NutritionDictionary ready for AWS

You are helping the owner set up a website called **NutritionDictionary** (nutritiondictionary.com) in their own Chrome. Their developer tools handle the code and the AWS deployment; you do the steps that need a web browser. Work through the parts in order, and at the end give the owner the report described in the last section.

## Rules: read these first
1. **The owner signs in.** When a site needs a login, a password, a 2-step code or a card number, stop and ask the owner to do it. Never type a password or a code yourself.
2. **Stop and ask before** you pay for anything, accept any terms, licence or Marketplace agreement, submit a form that makes a statement on the owner's behalf, or create an AWS Organization. Show the owner exactly what you're about to do, and continue only when they say yes.
3. **Don't change anything that already exists.** The owner's AWS account already runs other sites (yenelij.org, Biblical Times, family-photos). Don't edit, stop or delete any existing resource there. Only create what these instructions list.
4. **AWS region:** always **US East (N. Virginia), us-east-1**. Check the region menu at the top right of the AWS console.
5. **Don't change the domain's nameservers.** They move to AWS later, in a separate step.
6. **Don't create AWS access keys** or download any credentials.
7. **If a page looks different** from what's described here, or something fails twice, describe what you see and ask the owner. Don't guess.
8. **Keep account IDs and email addresses in your report to the owner only.** Don't paste them anywhere else.

## Part A: Buy the domain and set up email (Porkbun)
1. Open <https://porkbun.com> in a new tab and search for `nutritiondictionary.com`.
2. If it's available for about **$11.81 for the first year**, add **1 year** to the cart. If it's taken, or the first-year price is over $20, stop and tell the owner.
3. In the cart, make sure **WHOIS privacy** is on (Porkbun includes it free) and **auto-renew** is on. Remove any add-ons, such as hosting, email hosting, SSL or website builders. AWS provides the certificate.
4. **Stop:** ask the owner to sign in or create a Porkbun account and complete the payment themselves.
5. After the purchase, open **Account → Domain Management** and find `nutritiondictionary.com`. **Leave the nameservers as they are** (Porkbun's).
6. Open the domain's **Email Forwarding** settings. Ask the owner which Gmail address to forward to, then create two forwards:
   - `hello@nutritiondictionary.com` → the owner's Gmail
   - `privacy@nutritiondictionary.com` → the owner's Gmail
7. Open the domain's **DNS records**. Write down every **MX** record exactly (host, answer/value, priority), plus any **TXT** record Porkbun added for forwarding. The owner needs them when the domain moves to AWS, so the forwarding keeps working.
8. Ask the owner to send a test email from another address to `hello@nutritiondictionary.com` and confirm it arrives. This can take up to an hour; carry on with Part B meanwhile.

## Part B: Check the existing AWS account
1. Open <https://console.aws.amazon.com>. The owner signs in to their **existing** account, as the root user or an administrator.
2. Open **Billing and Cost Management**. Find the account's **plan**. AWS calls it the "Free plan" or the "Paid plan", and it may appear under **Account** or in a banner. Report which one it shows. Don't change it.
3. Open **AWS Organizations**. Report whether an organization already exists, and if so its ID (`o-...`) and how many accounts it has.

## Part C: Create the dev and prod accounts (AWS Organizations)
1. **If no organization exists:** **stop** and ask the owner to confirm. Explain: "This makes your current account the organization's management account. Its bills and the new accounts' bills are combined into one. It's free, and your existing sites keep working." When they say yes, choose **Create an organization** (with all features).
2. Choose **Add an AWS account → Create an AWS account**:
   - **Account name:** `nutritiondictionary-prod`
   - **Email:** the owner's Gmail with `+nd-prod` added before the `@` (e.g. `name+nd-prod@gmail.com`). Confirm the exact address with the owner first.
   - **IAM role name:** leave the default, `OrganizationAccountAccessRole`.
3. Repeat for **`nutritiondictionary-dev`**, with `+nd-dev` in the email.
4. Wait until both accounts show **Active**, refreshing the page every minute or so. Write down each account's **12-digit account ID**.

## Part D: GitHub deploy settings
1. Open <https://github.com/yonaadug/FoodNutritionOptimize/settings/environments>. The owner may need to sign in.
2. **New environment** named `dev`. Add no protection rules.
3. **New environment** named `production`:
   - Turn on **Required reviewers** and add the owner (`yonaadug`).
   - If **Prevent self-review** is shown, leave it **off**, so the owner can approve their own deploys.
   - Under **Deployment branches**, choose **Selected branches** and allow only `main`.
4. In **each** environment, add an **environment secret** named `ALERT_EMAIL`, whose value is the owner's Gmail address (ask them). Budget and error alerts go there.
5. Don't add any other secrets or variables. They come after AWS setup.

## Part E: Bedrock access and limits, in the prod account
Do this only after Part C, inside the **new prod account**:
1. In the AWS console, open the account menu (top right) → **Switch role**. Enter the prod account ID from Part C, the role `OrganizationAccountAccessRole`, and a display name `nd-prod`. Check that the top bar now shows `nd-prod`, and that the region is **us-east-1**.
2. Open **Amazon Bedrock → Model catalog** and open **Claude Haiku 4.5** (by Anthropic). If it asks for Anthropic's **use case details**, fill the form in like this, then **stop** and show the owner before you submit:
   - **Company name:** NutritionDictionary
   - **Website:** https://nutritiondictionary.com
   - **Industry:** Health and wellness (or the closest choice)
   - **Intended users:** external users (the public)
   - **Use case:** "A nutrition website reads recipe text and photos of recipe cards into ingredient lists, which are matched to USDA nutrition data. Users review every result. No medical advice."
3. Still in the Model catalog, open **Claude Haiku 5.5**, then **Claude Sonnet 5.5**. If either shows **Request access**, **Subscribe** or an **AWS Marketplace offer or agreement**, **stop** and show the owner the terms. Accept only when they say yes.
4. Open **Service Quotas → AWS services → Amazon Bedrock**. Search for the quota codes **`L-47520EB7`** and **`L-F26CA8D1`**. For each, report the **Applied quota value**.
   - **If it's 0 or very low:** choose **Request increase at account level**, ask for **400,000**, and if a reason is required, use: "Launching a consumer nutrition website that reads recipe photos with Claude through cross-region inference; expected peak a few hundred requests per hour." Submit, and write down the request ID.
5. Still in **Service Quotas**, open **AWS Lambda → Concurrent executions**. If the applied value is **below 1,000**, request **1,000**, with the reason "Production web app; per-function reserved concurrency needs headroom." Write down the request ID.
6. Switch back to the owner's original account when done (account menu → **Switch back**).

## Not yet: leave these for later
- **AWS Activate credits.** They need the website to be live first.
- **Google sign-in (Google Cloud OAuth client).** It needs the privacy policy page to be live first.
- **SES production access (sending email).** It comes after the first deployment.
- **Changing the domain's nameservers to AWS Route 53.** It comes during deployment.

## Your report to the owner
Finish by giving the owner this block, filled in. Write "not done" and the reason for anything you skipped.

```
DOMAIN: nutritiondictionary.com bought (yes/no), renews on <date>, WHOIS privacy on (yes/no)
EMAIL FORWARDING: hello@ and privacy@ forward to the owner's Gmail (yes/no); test email arrived (yes/no/pending)
PORKBUN MX/TXT RECORDS: <each record: host, type, value, priority>
AWS PLAN (existing account): Free plan / Paid plan
ORGANIZATION: created now / already existed, ID o-...
PROD ACCOUNT ID: ............   DEV ACCOUNT ID: ............
GITHUB: environments dev and production created (yes/no); production reviewer: yonaadug; ALERT_EMAIL secret in both (yes/no)
BEDROCK (prod): use-case form submitted (yes/no); Haiku 5.5 access: ...; Sonnet 5.5 access: ...
QUOTAS (prod): L-47520EB7 applied <value>, request <id/status>; L-F26CA8D1 applied <value>, request <id/status>; Lambda concurrency applied <value>, request <id/status>
PROBLEMS OR QUESTIONS: ...
```
