# Legal pages and consent

> **Drafts for a lawyer to review. None of this is legal advice.** The pages and this document were written on 2026-11-14 from the code and [DECISIONS.md](DECISIONS.md), to give the owner's lawyer something concrete to review. While `LEGAL_DRAFT` is `true`, every legal page and the sign-in form say "Draft, under legal review".

## Where things are

| What | Where |
|---|---|
| Versions, effective date, retention, placeholders, `LEGAL_DRAFT`, `MINIMUM_AGE` | `food-nutrition-app/lib/legal.ts` (the one source of truth) |
| Privacy Policy | `/privacy`, `app/privacy/page.tsx` |
| Consumer Health Data Privacy Policy | `/health-data-privacy`, `app/health-data-privacy/page.tsx` |
| Terms of Use | `/terms`, `app/terms/page.tsx` |
| Shared page frame and the draft note | `components/legal/` |
| Footer links (every page, so also the homepage, as MHMDA asks) | `components/shell/SiteFooter.tsx` |
| Recorded consent | `lib/consent.ts` (storage, rules, pending cookie), `lib/consent-http.ts` (API and guards), `lib/consent-pages.ts` |
| Consent UI | `components/account/ConsentChecks.tsx` (the boxes), `SignInForm.tsx`, `ConsentGate.tsx` (review step), `AccountAgreements.tsx` (account page) |
| Tests | `lib/consent.test.ts` (SQLite and dynalite), `lib/legal.test.ts` (pages vs code vs decisions) |

Notes for the lawyer are also on the pages themselves, in dashed boxes marked "For the lawyer (shown only in the draft)". They disappear when `LEGAL_DRAFT` is turned off.

## The consent flow

1. **Sign-in page.** Three boxes, all required before a link is emailed or Google sign-in starts:
   - "I agree to the Terms of Use and have read the Privacy Policy."
   - "I am 13 or older." (`MINIMUM_AGE`)
   - A **separate, specific** consent to collecting consumer health data, with a short disclosure under it (what, why, who processes it, how to withdraw) and a link to the health data policy, as MHMDA asks of a consent request (RCW 19.373.010 definition of consent, .030).
2. The ticks go to `POST /api/consent`. Signed out, the server answers with a signed, httpOnly cookie `md.consent` (versions + time, 30 minutes). **The server refuses** `POST /api/auth/sign-in/magic-link` and `/sign-in/social` without a valid one (403, `details.reason: consent_required`), so a script can't skip the boxes.
3. After the link or Google returns, `/account/sign-in/done` checks the account's consent record:
   - **current**: continue as before;
   - **pending cookie present**: record it (`POST /api/consent {usePending:true}`) and continue;
   - **missing or older than `POLICY_VERSIONS`** (the link was opened in another browser, or a policy changed): show the boxes again with what changed, and "Sign out instead". Until they agree, the browser isn't told it's signed in, so nothing is recorded to the account.
4. **What's stored**, under the user's partition through the existing table API: `USER#<id> / CONSENT` (latest) and `USER#<id> / CONSENTLOG#<iso time>` (every agreement). Fields: `versions {terms, privacy, healthData}`, `minimumAge`, `healthDataConsent: true`, `agreedAt`, `method` (`sign-in-form` or `sign-in-review`). **No IP address and no user agent.** No change to `lib/user-store` was needed.
5. **Existing accounts:** bump a version in `lib/legal.ts` and every account is asked again at its next sign-in. A signed-in account with an older version also sees a "We've updated our policies" notice on `/account`.
6. **Guards:** `POST /api/history` is refused (403 `consent_required`) for an account with no health-data consent on record, so nothing health-related is collected without it. An older-version consent still counts for history until the next sign-in asks again. `/account` sends an account with no consent to the review step.
7. **Access and deletion:** the export (`/api/account/export`) now includes `consent: { current, status, history }`. Deleting the account deletes the consent records with everything else.

## Data inventory

"Basis" is the proposed GDPR lawful basis; the lawyer should confirm each. "CHD?" is whether it could be consumer health data under MHMDA.

| Data | Where stored | Retention | Processor | Basis | CHD? |
|---|---|---|---|---|---|
| Email address | DynamoDB `USER#<id>/PROFILE` and `EMAIL#<email>` pointer | Until account deletion (+ backups 35 days) | AWS | Contract | No |
| Display name | DynamoDB `PROFILE` | Same | AWS | Contract | No |
| Google: name, email, profile picture URL, Google account ID, `emailVerified` | DynamoDB `PROFILE`, `ACCOUNT#<id>` | Same | AWS, Google | Contract | No |
| Google OAuth access, refresh and ID tokens | DynamoDB `ACCOUNT#<id>` (not encrypted at app level; DynamoDB encrypts at rest) | Same | AWS | Contract | No |
| `preferences` (free-form, ≤2 KB) | DynamoDB `PROFILE` | Same | AWS | Contract | Possibly; nothing writes it today |
| Food history (food id, name, calories, "rich in") | DynamoDB `HIST#food#<id>` | Until deleted; 500 per kind, oldest removed | AWS | Explicit consent (Art. 9(2)(a)) | Possibly |
| Recipe history (title, ingredients, per-serving nutrition) | DynamoDB `HIST#recipe#<id>` | Same | AWS | Explicit consent | Possibly |
| Plan history (foods, amounts, limits, nutrient goals, recipes, summary) | DynamoDB `HIST#plan#<id>` | Same | AWS | Explicit consent | Yes, likely (diet goals) |
| Consent records | DynamoDB `CONSENT`, `CONSENTLOG#<time>` | Until account deletion | AWS | Legal obligation (Art. 7(1)) / legitimate interests | No |
| Sessions (token, expiry, copy of the user record; IP and user agent set to null) | DynamoDB `KV#<token>` | 30 days from last renewal; deleted on sign-out | AWS | Contract | No |
| Sign-in link tokens (hashed) with the email | DynamoDB `KV#…` | 15 minutes | AWS | Contract | No |
| Google sign-in state | DynamoDB `KV#…` (10 min) and cookie `md.state` (5 min) | Minutes | AWS | Contract | No |
| Better Auth sign-in rate limits | DynamoDB `KV#<raw IP>\|<path>` | 60–300 s TTL (see discrepancies) | AWS | Legitimate interests | No |
| App rate-limit counters (keyed hash of IP, email or user id) | DynamoDB `RL#<scope>#<hash>` | 2 windows (2 min to 2 h) | AWS | Legitimate interests | No |
| Recipe-reader rate limit (raw IP) | Server memory only, per Lambda instance | Up to 24 h, lost on cold start | AWS | Legitimate interests | No |
| Recipe photos | Not stored; sent in the request to Bedrock | Request lifetime (decision: never over 1 day) | AWS Bedrock | Contract | Possibly |
| Pasted recipe text the built-in reader is unsure of | Not stored; sent to Bedrock | Request lifetime | AWS Bedrock | Contract | Possibly |
| Planner inputs (foods, goals) when making a plan | Not stored server-side | Request lifetime | AWS | Contract | Possibly (anonymous) |
| Server logs (route errors, AI cost lines, pseudonymous account events) | CloudWatch Logs | 14 days | AWS | Legitimate interests | No |
| Request data at the edge (IP, URL, headers) | CloudFront, firewall | AWS's own retention; no access logs configured in the CDK example | AWS | Legitimate interests | No |
| Sign-in email (address, link) | Sent through SES | SES's own retention | AWS SES | Contract | No |
| Plus: Stripe customer id, plan, status, period dates | DynamoDB (billing work in progress) | Until account deletion | Stripe, AWS | Contract; invoices: legal obligation | No |
| Card details, billing address, invoices | Stripe only | Stripe's retention (tax law) | Stripe | Contract / legal obligation | No |
| Planner, last plan, recent recipes, recent searches | Browser `localStorage` (keys in `BROWSER_STORAGE`) | Until cleared, sign-out or deletion | None | n/a (device) | Possibly, but never leaves the device unless used |
| Theme, `md.signedIn`, `md.localOwner` | Browser `localStorage` | Until cleared | None | n/a | No |
| Pending consent | Cookie `md.consent` (httpOnly, signed) | 30 minutes, cleared once recorded | None | Legitimate interests / consent | No |
| All of the above in DynamoDB | Point-in-time recovery backups | 35 days | AWS | Same as source | Same |

No analytics, ads, tracking pixels, Cloudflare scripts or third-party fonts (the Inter font is self-hosted by `next/font`).

## Placeholders the owner must fill

All in `lib/legal.ts` unless noted. Pages mark them in a monospace box.

| Placeholder | Where it shows |
|---|---|
| `[OWNER LEGAL NAME]` (`OWNER_LEGAL_NAME`) | All three pages. Don't put the owner's name in without them |
| `[OWNER POSTAL ADDRESS, IF REQUIRED]` | Privacy Policy (Who we are, Contact) |
| `[GOVERNING LAW AND VENUE]` | Terms |
| `[REFUND POLICY: …]` | Terms (Plus) |
| `[EU AND UK REPRESENTATIVE, IF REQUIRED]` | Privacy Policy (GDPR) |
| `[TRANSFER MECHANISM: …]` | Privacy Policy (International transfers), inline in the page |
| `[30]` days price-change notice | Terms (Plus), inline |
| `[US$ AMOUNT]` liability floor | Terms (Limits of liability), inline |
| `[WHAT HAPPENS TO PREPAID PERIODS…]` if Plus is discontinued | Terms (Ending your use), inline |
| `privacy@nutritiondictionary.com` (`CONTACT_EMAIL`) | **A real address the owner must create.** Set up a mailbox or forwarding (for example SES receiving or the registrar's email forwarding) before launch. Nothing receives it today |
| `LEGAL_EFFECTIVE_DATE`, `POLICY_VERSIONS` | Set the real launch date and drop `-draft` when approved |

## Questions for the lawyer

1. **Minimum age.** `MINIMUM_AGE = 13` (COPPA). GDPR Art. 8 makes 16 the default for consent-based online services (member states may lower it to 13), and the health-data processing here relies on Art. 9 explicit consent. Should the EU be 16? The roadmap says "no targets for under-18s" and the AWS design suggested 18: should the whole site be 16 or 18?
2. **Does MHMDA apply** given where the owner is based? It reaches entities that do business in Washington or target Washington consumers, has no revenue threshold and has a private right of action. Same question for **Nevada SB 370** (does our page meet its list of contents?) and **Connecticut** (Public Act 23-56 applies its consumer health data rules to any person; reportedly the 2025 SB 1295 amendments extend the full CTDPA to anyone processing sensitive data from July 1, 2026: confirm, and whether a data protection assessment is needed).
3. **Is it consumer health data at all?** Food views, recipes and macro goals ("Lower carb", "High protein") are borderline. And do **signed-out** plan and recipe requests (processed, not stored, linked only to an IP) need MHMDA consent?
4. **Bundled consent.** An account can't be created without the health-data box, because saving history is what an account is for. Is that "freely given" (GDPR Art. 7(4)) and valid under MHMDA, or should accounts be possible without it (no history)?
5. **Refund policy** for Plus, and the **price-change notice** period.
6. **Auto-renewal compliance** (checklist on `/terms`): California ARL (Bus. & Prof. Code §§ 17600–17606, amended by AB 2863 from July 2025), New York GBL §§ 527–527-a, ROSCA (15 U.S.C. §§ 8401–8405), other states, and the status of the FTC's vacated click-to-cancel rule. The disclosure and separate consent must sit on the checkout page (billing work, `app/plus`); is the Stripe portal's cancel-at-period-end flow enough? Does a no-card trial that never converts trigger any trial-notice duty? EU/UK 14-day withdrawal right for digital services.
7. **Governing law and venue**, the **liability cap**, and whether to add arbitration (consumer-law limits apply).
8. **Milne et al. 2024** microplastics data is CC BY-NC-ND 4.0 and the site has paid features (open in `TODO.md`). Is citing its numeric values allowed, or should its rows go? Also Cox 2019 (© ACS, values only) and Kosuth 2018 (CC BY).
9. **AI terms.** Do the AWS Service Terms for Amazon Bedrock, the Anthropic model terms on Bedrock and the Amazon Nova terms allow showing model output in a paid product, and who owns it? Anthropic's usage policy has extra requirements for some high-risk uses (health among them): does recipe nutrition reading fall under it, and is the "AI reads can be wrong, check them" disclosure enough?
10. **GDPR mechanics:** an EU and UK representative (Art. 27)? Transfer mechanism (EU-U.S. Data Privacy Framework vs SCCs; AWS, Stripe and Google DPAs)? A DPIA (Art. 35) and record of processing (Art. 30)? Or geo-restrict EU/UK sign-ups at launch, as the AWS design offered?
11. **CCPA:** we likely fall below the thresholds; is the sign-in page's notice enough as a notice at collection? Is no "Limit the use of my sensitive personal information" link needed, given it's used only for the service?
12. **Cookies:** no banner, on the basis everything is strictly necessary (ePrivacy Art. 5(3), PECR reg. 6). Confirm.
13. **Retention:** should consent records outlive account deletion as proof? Should inactive accounts be deleted after a period? Is 35 days of backups after deletion acceptable as stated?
14. **FTC Health Breach Notification Rule** (16 CFR Part 318): is the site a vendor of personal health records? The policy promises notice "as the law requires"; the owner needs an incident runbook.
15. **Accuracy of commitments** the pages make on the owner's behalf: answering within one month (45 days for health data) with an appeal; not restoring deleted data from backups except after a failure; email cancellation of Plus; only the owner having access.

## What changes once they answer

| Answer | Change |
|---|---|
| Age | `MINIMUM_AGE` in `lib/legal.ts`. The box, pages and stored records follow. A higher age makes older records "outdated", so everyone is asked again |
| Any wording change to a page | Edit the page, bump its entry in `POLICY_VERSIONS` and `LEGAL_EFFECTIVE_DATE`. Accounts are asked again at next sign-in |
| Placeholders | Fill the constants in `lib/legal.ts` and the inline ones listed above. `lib/legal.test.ts` fails if a bracketed placeholder remains once `LEGAL_DRAFT` is off |
| Approved | Set `LEGAL_DRAFT = false` and drop `-draft` from the versions (the test enforces both together). The draft note, footer "Drafts" label and lawyer boxes disappear |
| Bundled consent not OK | Make the health box optional in `ConsentChecks.tsx` and `parseConsentInput`, store `healthDataConsent: false`, and keep the history guard as it is (it already refuses history without consent) |
| MHMDA does not apply | Keep the policy anyway (cheap), or soften its framing; the consent and guard can stay |
| Auto-renewal | The billing checkout must show the disclosure and capture separate consent; `/terms` is the reference text |
| Milne removed | Delete its rows from `data/contaminants/microplastics.tsv` and its citation on `/methodology` and `/terms` |
| EU representative, transfer mechanism | Fill the placeholders on `/privacy` |

## Code and doc discrepancies found

1. **Photos.** DECISIONS.md says uploaded photos are deleted after 1 day (the AWS design's S3 bucket has a 1-day lifecycle). The code never stores them: `/api/recipes/parse` reads the upload into memory and sends it straight to Bedrock. The policy says "not saved, never more than 1 day".
2. **Raw IP addresses are stored.** ACCOUNTS.md says rate-limit counters are hashed with no raw IPs. That's true for the app's `RL#` counters, but Better Auth's own sign-in rate limits are stored as `KV#<ip>|<path>` with the raw IP (verified: `KV#198.51.100.7|/sign-in/magic-link`, TTL 300 s). DynamoDB TTL deletes lazily (usually within days) and PITR keeps 35 days. The policy discloses it. To fix it, `lib/auth/handlers.ts` could pass Better Auth a keyed hash mapped to a synthetic IPv6 address instead of the real one.
3. **More is stored per profile than documented.** ACCOUNTS.md lists "email, name, preferences". The PROFILE item also holds `emailVerified` and, for Google users, `image` (the Google profile picture URL). Google ACCOUNT items hold access, refresh and ID tokens, not encrypted at the app level (Better Auth's `account.encryptOAuthTokens` is off; consider turning it on in `lib/auth/auth.ts`, or not storing tokens the site never uses). The export rightly leaves tokens out.
4. **The recipe reader's rate limiter** keeps raw IPs in server memory for up to 24 hours (`lib/ai/rate-limit.ts`). It isn't mentioned in ACCOUNTS.md or the AWS design's privacy notes. Disclosed in the policy.
5. **Log retention.** DECISIONS.md: 14 days. The CDK example's Stripe webhook log group is `ONE_MONTH` (`docs/aws/infra-example`). The policy says 14 days, so that log group should change.
6. **Export didn't include consent** (it didn't exist). The export route now wraps the handler to add it, without touching `lib/user-store`.
7. **The AWS design's profile** lists optional sex/age band and `consentVersion`; neither is stored (consent is now its own item).
8. **`preferences`** exists in the profile and `PATCH /api/me`, but nothing in the UI writes it.
9. **Not changed here (other owners):** ACCOUNTS.md's "Before launch: consent and legal" item and threat-model note can now point here; the sitemap (`app/sitemap.ts`) doesn't list the three legal pages; the account page's delete section (`AccountView.tsx`, billing agent) could add one line linking to `/privacy#backups`. `AccountAgreements` sits right below it with that link for now.
