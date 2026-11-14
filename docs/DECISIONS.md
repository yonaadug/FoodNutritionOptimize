# Owner decisions

Decisions the owner made, newest first. Agents and docs follow these; change them here first.

## 2026-11-14

**Name and domain**
- The product is **NutritionDictionary**, at **nutritiondictionary.com** ([aws/DOMAIN.md](aws/DOMAIN.md)).
- Register it at **Porkbun** ($11.81/yr) and point its nameservers at Route 53.

**Recipe AI** (being built)
- Pasted text goes through the built-in reader first, and AI is used only when the reader is unsure.
- Claude Haiku 5.5 is the default. Sonnet 5.5 is used only for photos of plated food or reads that fail validation.
- Amazon Nova Lite is the fallback while the account's Claude quota is 0.

**Plus** ([STRIPE_PLAN.md](STRIPE_PLAN.md))
- **Unlocks:**
  - a monthly AI photo quota
  - unlimited saved plans and recipes on every device
  - a week planner with a grocery list
  - a contaminant check across a whole plan
- **Always free:** food pages, contaminant meters, the one-day planner, pasted-text recipes, data export.
- **Trial:** every new account gets a 14-day "reverse trial" with no card and capped AI.
- **Price:** $5.99/month or $39.99/year.

**AWS** ([aws/AWS_HOSTING_DESIGN.md](aws/AWS_HOSTING_DESIGN.md))
- Separate **dev and prod accounts** in one AWS Organization, in us-east-1.
- **Budget alerts:** $10/month for prod, $5 for dev. Email at 80% and 100%; at 150% the kill switch turns AI off (the site stays up).
- **AI daily cap:** $5.
- **Firewall:** the CloudFront flat-rate Free plan's built-in firewall. Revisit at about 6,000 monthly users.
- **Bot check:** no Turnstile at launch; add it only if abuse appears.
- **Deploys:** GitHub Actions with OIDC (no stored AWS keys). Dev deploys on every push to main; prod deploys only after the owner approves in GitHub.
- **Alerts** go to the owner's usual email, set as a private deploy-time setting and never committed.

**Sign-in and email** ([ACCOUNTS.md](ACCOUNTS.md))
- **Sign-in:** email links **and Google** at launch. The owner creates the Google OAuth app.
- **Sender:** no-reply@nutritiondictionary.com.
- **Sessions:** 30 days, renewed on use. Sign-in links expire after 15 minutes.
- **Cognito:** remove it from the AWS example.

**Data**
- **Retention:** uploaded photos deleted after 1 day, logs kept 14 days, DynamoDB backups (point-in-time recovery) 35 days. The privacy policy must say a deleted account leaves backups within 35 days. *(Today photos aren't stored at all: they go straight to Bedrock. The 1-day S3 rule covers the planned import queue.)*
- **Access:** worldwide, so the privacy policy covers EU/UK users (GDPR) too.

**Launch**
- **Everything at once,** including accounts and photo AI (owner's choice; the safer staged option was declined).
- **Still required before launch:**
  - a privacy policy and terms, ideally reviewed by a lawyer (health-data laws such as Washington's My Health My Data Act apply)
  - the Google OAuth consent screen
  - SES production access
  - the Bedrock quota increase
