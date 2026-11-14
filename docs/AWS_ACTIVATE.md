# Applying for AWS Activate Founders credits

**What you get:** $1,000 in AWS credits to start, and some startups qualify for up to $5,000. Credits usually expire within 1–2 years. They cover over 200 services, **including third-party models on Amazon Bedrock such as Claude**. They don't apply to past bills, so apply before the costs start. Review takes about 5–10 business days, and the result arrives by email. *(AWS pages, checked 2026-11-14: [startups/credits](https://aws.amazon.com/startups/credits), [everything you need to know](https://aws.amazon.com/aws-startups/learn/everything-you-need-to-know-about-aws-activate-credits/), [step-by-step guide](https://aws.amazon.com/aws-startups/learn/applying-for-aws-activate-credits-a-step-by-step-guide).)*

## Founders eligibility, and where you stand

| AWS requirement | You | To do |
|---|---|---|
| New to Activate credits | Yes | — |
| Self-funded | Yes | — |
| Founded in the past 10 years | Yes (2026) | — |
| **A fully functioning company website** | **Not yet**: nutritiondictionary.com isn't registered or live | Steps 1 and 3 |
| A business email matching the website's domain (AWS says this "helps validate your application") | Not yet | Step 2 |
| An AWS account on the **Paid Tier Plan** | Almost certainly: accounts created before AWS's July 2025 "Free plan" are paid-tier accounts | Confirm in the console: Billing and Cost Management, account plan |

Incorporation isn't listed as a requirement.

## Steps

1. **Buy the domain.** Register `nutritiondictionary.com` at Porkbun ($11.81/yr; see [aws/DOMAIN.md](aws/DOMAIN.md)).
2. **Set up a business email.** In Porkbun, use the domain's email forwarding to send e.g. `hello@nutritiondictionary.com` to your Gmail. Receiving is enough for Activate. Create `privacy@` at the same time, since the privacy policy uses it.
3. **Put the site live.** Follow [DEPLOY.md](DEPLOY.md) at least as far as the production site serving food pages at `https://nutritiondictionary.com`. Sign-in can wait for SES approval; the food lookup, contaminant meters and planner work without it.
4. **Choose the account to link:** your **existing 2022 account**, which becomes the AWS Organization's management (billing) account in DEPLOY.md. Credits on the management account are shared across the organization's accounts by default. Linking needs the root user or an admin IAM user, and only one Builder ID can link to an account.
5. **Apply.**
   - Go to <https://aws.amazon.com/startups/credits>, click **Apply now**, and create or sign in to an **AWS Builder ID** (AWS's guide says to use your personal email for it).
   - Complete the one-time Activate profile with the **business email** from step 2.
   - Choose **Founders**, and fill in the startup details using the answers below.
   - Link the account, then click **Verify your account** in the console, and submit.
   - **Applications can't be edited after you submit them** (you'd have to cancel, unlink the account and reapply), so check everything first.
6. **Wait for the email** (5–10 business days). Credits appear in Billing within a few hours of approval. If you're declined, the step-by-step guide's tips are about mismatched email domains and funding-stage errors.

## Answers to paste (edit to taste)

**Company name:** NutritionDictionary

**Website:** https://nutritiondictionary.com

**Funding stage:** Pre-seed, self-funded. No outside funding. *(If the form insists on a "most recent funding date", use the date you started the project.)*

**Product:**
> NutritionDictionary is a free website for looking up what's in food. It covers about 9,400 USDA foods with full nutrient data, and shows per-serving levels of lead, cadmium, mercury, arsenic, pesticide residues and microplastics from FDA, EPA and USDA testing, with sources. A meal planner uses linear programming to find the fewest-calorie day that meets a person's nutrient goals from foods they choose. A recipe analyzer reads pasted text or a photo of a recipe card, matches each ingredient to USDA data, and shows nutrition per serving. A Plus subscription ($5.99/month or $39.99/year) adds a week planner with a grocery list, a contaminant check across a whole plan, more photo reads, and unlimited saved history.

**Target market:**
> US adults who cook at home and want to understand the nutrients and contaminants in their food: people tracking micronutrients, planning meals around nutrient goals, or choosing lower-mercury and lower-arsenic foods. The core lookup is free and public; revenue comes from the Plus subscription.

**Current traction** (be honest; update before you submit):
> Pre-launch. The product is built and tested (about 1,000 automated tests) and is launching on AWS at nutritiondictionary.com. No users or revenue yet.

**How you'll use the credits** (if asked):
> Hosting on CloudFront, Lambda (container image), DynamoDB, SES and Route 53, and Amazon Bedrock (Claude Haiku and Sonnet, Amazon Nova) to read recipe photos into ingredient lists. Bedrock is our largest variable cost; the credits cover our first year of AI usage while we find paying users.
