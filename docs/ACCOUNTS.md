# Accounts

Optional sign-in, so people can come back to the foods, recipes and plans they've looked at. The whole site works without an account. Accounts are also the base for a paid plan later ([STRIPE_PLAN.md](STRIPE_PLAN.md) §8), which is not built here.

**Status:** tested on a laptop against SQLite and a DynamoDB emulator. Nothing has run on AWS yet, and real email has not been sent. See [What hasn't been tested](#what-hasnt-been-tested).

## Decision: Better Auth, not Cognito

Use **[Better Auth](https://www.better-auth.com/) 1.7** with passwordless email links, storing everything in our own table (SQLite locally, DynamoDB in production).

The AWS design ([§3.5](aws/AWS_HOSTING_DESIGN.md#35-auth)) proposed Cognito and suggested self-hosted auth only above about 25k MAU, mainly because self-hosting means owning password security. This deviates from it for three reasons:

1. **Cognito can't be tested on a laptop.** That is a hard requirement here: no AWS account and no email provider needed.
2. **There are no passwords to own.** The design's main objection was password hashing and account recovery. Email links have neither, and Better Auth handles the tokens, sessions and cookies.
3. **It doesn't get more expensive with growth.** Cognito Essentials becomes the design's biggest line item at about 25k+ MAU ($450/mo at 100k app MAU, per §3.5). Here, the cost is DynamoDB requests and SES at $0.10 per 1,000 emails.

What this gives up, and you should weigh it: **security patches and abuse handling are now ours.** A vulnerability in Better Auth or in our adapter is ours to find out about and fix, where Cognito would be AWS's job. Keep Dependabot and `npm audit` on, and update Better Auth promptly. It ships often, and it is pinned to an exact version so updates are deliberate.

| Option | Verdict | Why |
|---|---|---|
| **Better Auth 1.7** | **Chosen** | Actively maintained, free, runs on any server, and has email links, Google, passkeys, rate limiting and origin checks built in. No official DynamoDB adapter, but it has a supported adapter API |
| Auth.js v5 | Rejected | Maintained by the Better Auth team since September 2025. v5 is still beta (`5.0.0-beta.32`) and new projects are pointed to Better Auth. It does have a DynamoDB adapter, its main advantage |
| Amazon Cognito | Rejected for now | Fails the offline requirement. Good fit if you'd rather pay to not own this |
| Lucia-style patterns | Rejected | Lucia itself is now a guide to writing session code yourself, which the requirements rule out |
| Clerk, WorkOS | Rejected | Paid SaaS, and they hold user data with a third party, which matters for health-adjacent data ([§6](aws/AWS_HOSTING_DESIGN.md#6-security--compliance)). Current free tiers were not checked, since SaaS fails the requirement anyway |

Community DynamoDB adapters exist (`@bjorntech/betterauth-dynamodb`, `@trkbt10/better-auth-dynamodb`), but they are young and from small maintainers, and an auth adapter sees every credential. Ours is about 300 lines, covers only what we use, and fails loudly on anything else.

**Switching to Cognito later** means replacing `lib/auth/`. History and profiles are keyed by user id, so existing users would need mapping to Cognito ids by email.

Sources (read 2026-11-04; the Auth.js status comes from secondary sources): [Better Auth 1.7 notes](https://releases.sh/better-auth/overview), [Auth.js integrations page](https://authjs.dev/getting-started/integrations), [LogRocket comparison](https://blog.logrocket.com/best-auth-library-nextjs-2026/). Two secondary sources also say Vercel acquired Better Auth in July 2026. That is unconfirmed, and worth checking for licence or roadmap changes.

## Try it on your laptop

```bash
cd food-nutrition-app
npm ci --ignore-scripts
PORT=3604 npm run dev     # no other settings needed
```

1. Open <http://localhost:3604> (use `localhost`, not `127.0.0.1`: the same-origin check compares exactly) and press **Sign in**.
2. Enter any email address. Nothing is sent. The link appears in the terminal:
   ```
   [auth] Sign-in link (printed instead of emailed; AUTH_EMAIL_TRANSPORT=console):
   [auth] http://localhost:3604/account/sign-in/confirm?token=...
   ```
3. Open it and press **Sign in**. Open any food page, or analyze a recipe at `/recipes` (the offline demo provider needs no AI key), and it appears on `/account`.

Data goes in `food-nutrition-app/.data/app.db` (gitignored, excluded from Docker images). Delete that folder to start over.

To test a production build:

```bash
npm run build
PORT=3604 AUTH_BASE_URL=http://localhost:3604 AUTH_EMAIL_TRANSPORT=console npm run start:standalone
```

`npm test` runs the account tests on both backends. DynamoDB tests use [dynalite](https://github.com/architect/dynalite), an in-process emulator, through the real AWS SDK, so there's nothing to install.

## For developers

```ts
import { recordHistory, useCurrentUser } from '@/lib/auth/client';

const { user, loading } = useCurrentUser();   // user is null for anonymous visitors

recordHistory({
    kind: 'recipe',                           // 'food' | 'recipe' | 'plan' | any lowercase word
    itemId: recipeId,                         // A-Z a-z 0-9 . _ : ~ -  (hash anything else)
    title: 'Lentil soup',
    href: '/recipes?id=abc',                  // must be a path on this site
    data: { caloriesPerServing: 320, proteinPerServing: 18 },
});
```

`recordHistory` is safe to call anywhere: it never throws, and **when signed out it does nothing**, with no request and nothing stored. What someone viewed before signing in is not added to their account afterwards. Recording the same item again moves it to the top. Writes are best-effort and not retried.

`data` is free-form JSON up to 8 KB. The history row shows these keys (`lib/auth/history-summary.ts`):

- `calories`/`kcal`, `protein`, `carbs`, `fat`, `fiber`
- the same with `PerServing`, such as `proteinPerServing`, or a `perServing: true` flag
- `summary: [{ label, value }]` for anything else
- `incomplete: ['calories']` marks a value as a lower bound (shown with ≥), and `estimated: true` adds a "from a photo" note

What's recorded today:

- **Foods:** `components/food/onFoodViewed.ts`, once each time a food page opens. These rows have a title and link, but no nutrition yet, because `onFoodViewed` isn't given any.
- **Recipes:** `components/recipes/RecipesPage.tsx`, through `lib/recipes/history.ts`. The analyzer calls this after the first read and again after edits with the same id, so one recipe stays one row. Only a summary is stored (per-serving calories, protein, carbs and fat, plus servings), not the ingredients. Rows link to `/recipes`, which opens the analyzer rather than that recipe, because saved analyses are only kept in that browser's `localStorage`.
- **Plans:** nothing yet. The tab, API and display are ready, but the planner doesn't call `recordHistory`.

The account control is `components/account/AccountMenu.tsx`, mounted in `components/shell/SiteHeader.tsx`.

### API

All responses are `private, no-store`. Errors are `{ error, code, details? }`, the same shape as `lib/api.ts`.

| Route | Purpose | Limit |
|---|---|---|
| `GET /api/me` | `{ user }`, or `{ user: null }` when signed out | 600/min per IP |
| `PATCH /api/me` | Update `{ displayName?, preferences? }` | writes |
| `GET /api/history?kind=&limit=&cursor=` | `{ items, nextCursor }`, newest first | 240/min per user |
| `POST /api/history` | Upsert `{ kind, itemId, title, href, data? }` | writes |
| `DELETE /api/history?kind=&itemId=` | Remove one item | writes |
| `DELETE /api/history?all=1[&kind=]` | Clear everything, or one kind | writes |
| `GET /api/account/export` | Download everything held, as JSON | 5/hour per user |
| `DELETE /api/account` | Delete permanently. Body: `{ confirmEmail }` | 5/hour per user |
| `/api/auth/*` | Better Auth, limited to the endpoints the site uses | 10 links per 5 min per IP; 5 emails per hour per address |

"Writes" means 120/min per user and 300/min per IP. Limits: 200-character titles, 8 KB of `data`, 16 KB bodies, and 500 items per kind, after which the oldest are removed.

### Storage

Everything sits behind one `SingleTable` interface (`lib/user-store/table.ts`) with SQLite and DynamoDB versions, and the same contract tests run on both. So the code you exercise on a laptop is the code that runs in production, apart from that thin layer.

| PK | SK | What | TTL |
|---|---|---|---|
| `USER#<id>` | `PROFILE` | email, name, preferences | |
| `USER#<id>` | `ACCOUNT#<id>` | sign-in method such as Google | |
| `USER#<id>` | `HIST#<kind>#<itemId>` | history item | |
| `USER#<id>` | `HISTCOUNT#<kind>` | item count, enforces the cap | |
| `EMAIL#<email>` | `EMAIL` | points to the profile, guarantees one user per email | |
| `ACCOUNTID#<id>`, `ACCTKEY#<provider>#<id>` | same as PK prefix | point to a sign-in method | |
| `KV#<key>` | `KV` | sessions, sign-in tokens, sign-in rate limits | yes |
| `RL#<scope>#<hash>` | `W#<window>` | rate-limit counters (hashed, no raw IPs) | yes |

Indexes: `GSI1` is all history by recency (`USER#<id>#HIST`) and stays free for the design's `STRIPECUS#` lookup. `GSI2` is **new compared with the AWS design**: history per kind (`USER#<id>#HIST#<kind>`).

Lookups by email use small pointer items, not an index. An index can't enforce uniqueness and is only eventually consistent, and neither is acceptable for "does this person already have an account?". Anonymous visitors never touch the table: no cookie means no read.

## Going to production on AWS

Nothing here has been created. These are the steps, in order.

1. **DynamoDB.** The CDK example (`docs/aws/infra-example/cdk`) already has the table, GSI1 and TTL on `expiresAt`. Add GSI2:
   ```ts
   table.addGlobalSecondaryIndex({ // or add to globalSecondaryIndexes on TableV2
     indexName: 'GSI2',
     partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
     sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
   });
   ```
2. **Remove Cognito from the stack**: the user pool and the `cognito-idp:AdminDeleteUser` permission.
3. **SES.** Verify the domain with DKIM, SPF and DMARC, and **request production access**, because new accounts can only email verified addresses.
4. **Permissions for the web Lambda:** `dynamodb:GetItem, PutItem, UpdateItem, DeleteItem, Query, BatchWriteItem` on the table and `index/*`, plus `ses:SendEmail`.
5. **Secret.** Generate with `openssl rand -base64 32` and store as an SSM SecureString. The app reads it from the environment, so your deploy has to pass it in. The design's §3.10 reads secrets at cold start, which would need a small addition to `lib/auth/config.ts`. Changing the secret signs everyone out.
6. **Environment:**
   ```
   USER_STORE=dynamodb                         # already the default on Lambda
   DYNAMODB_TABLE=<table name>
   AUTH_BASE_URL=https://micronutrientdiary.com
   AUTH_SECRET=<from SSM>
   AUTH_EMAIL_FROM=Micronutrient Diary <no-reply@micronutrientdiary.com>
   AUTH_IP_HEADERS=cloudfront-viewer-address
   ```
   With no email settings a production build won't start sign-in, and pages say it's unavailable. The rest of the site is unaffected.
7. **CloudFront.** Keep account routes on the default behavior, which must forward cookies. Add **`CloudFront-Viewer-Address`** to its origin request policy.
   > **Check this one after deploying.** If that header doesn't arrive, per-IP limits on the app's routes are skipped and every visitor shares one sign-in bucket, so ten requests in five minutes would lock out sign-in for everyone. Better Auth logs a warning when it can't find an IP. Look for it in CloudWatch.
8. **Test on the deployed site:** sign in with a real inbox, try a corporate mailbox that scans links, export, delete. Also check that POSTs get through origin access control. `lib/auth/client.ts` sends the `x-amz-content-sha256` header that needs, and this has not been run against real CloudFront.

**Google sign-in (optional):** create an OAuth client with the redirect `https://<site>/api/auth/callback/google`, then set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The button appears by itself.

**Passkeys (optional, not added):** `@better-auth/passkey`, plus a `passkey` entry in `MODELS` in `lib/auth/adapter.ts`, which rejects unmapped models on purpose.

**Stripe later:** the `ENT` item from the design fits under `USER#<id>`, and account deletion will remove it. `deleteAccount` in `lib/auth/handlers.ts` **must then cancel the subscription first**.

## Threat model

| Threat | Defence |
|---|---|
| Stolen or guessed sign-in link | Random token, single use (consumed atomically, tested with concurrent requests), expires in 15 minutes, stored only as a hash |
| Mail scanners using up the link | The link opens a page with a button, and only pressing it spends the token |
| Link leaking through `Referer` or logs | Confirm page is `no-referrer` and has no third-party resources. Tokens and emails are scrubbed from logs |
| Sign-in links printed in production logs | Console delivery is refused unless the site is on localhost |
| Finding out who has an account | Same response whether or not the address is known, including when throttled |
| Flooding someone's inbox | 5 emails per hour per address, across all IPs. Over the limit, nothing is sent and the response doesn't change |
| Stolen session cookie by script | `httpOnly`, so scripts can't read it. `Secure` with the `__Secure-` prefix on https, `SameSite=Lax` |
| CSRF | `SameSite=Lax`, plus an exact `Origin` check on every change, and JSON-only bodies. Sign-in routes use Better Auth's own origin check |
| Open redirect after sign-in | Better Auth checks callback URLs against the site's origin |
| Malicious links in history | `href` must be a path on this site, checked on write and again on render |
| Reading another person's data | Every query is keyed by the session's user id, never by input. Pagination cursors are tied to their partition |
| Filling the database | Size limits, per-kind cap, rate limits |
| Rate-limit evasion by header | The internal IP header is overwritten on every request. IPv6 counts per /64 |
| Personal data in logs | Keyed pseudonyms only. Sessions don't store IP or user agent. Telemetry is off |
| Forgotten sessions after sign-out or deletion | No cookie cache, so revocation applies on the next request |
| An unattended signed-in browser | Deletion requires typing the email address. Export is **not** re-confirmed |

**Accepted risks:**

- **Anyone with access to someone's inbox can sign in as them.** That's inherent to email links.
- **Login CSRF:** someone could send you *their* link, and you'd be signed in as them. You'd see their email on the account page. Low harm, since there's no payment data yet. Revisit before Stripe.
- **Deletion race:** a history write already past its session check when an account is deleted could recreate one orphaned item. The window is milliseconds.
- **Backups:** deleted data stays in DynamoDB point-in-time recovery for up to 35 days. The privacy policy must say so ([§6](aws/AWS_HOSTING_DESIGN.md#6-security--compliance)).
- **A leaked `AUTH_SECRET` plus table access** allows forging sessions. Rotate it, which signs everyone out.

## Before launch

Not done here, and not optional.

- **Consent and legal.** The sign-in page has a plain-language notice, but the design's §6 calls for separate, recorded consent to collect health-related data (Washington MHMDA, GDPR), an age statement, a privacy policy and terms. None of those exist yet, and no consent is recorded. Get legal review first.
- **Desktop app.** `electron-app` loads this same header, so it shows **Sign in**, which leads to "isn't available" in a packaged build. The design wants desktop free of cloud features, so that needs a build flag.
- **The AWS doc still describes Cognito** (§1, §3.5, §5, the diagram and the CDK example), and STRIPE_PLAN §8 still says "decision pending". Update them when you accept this decision.

## What hasn't been tested

- **Real DynamoDB.** dynalite parses real expressions but isn't DynamoDB. It has no eventual consistency on indexes, no throttling and no TTL deletion. The design handles all three in principle (history tolerates stale indexes, retries cover unprocessed batches, reads filter expired items), but only a deployed test proves it.
- **Real email.** The SES sender has never run, because there's no AWS account here. Delivery, spam placement and the HTML email's appearance are all unverified.
- **Google sign-in.** It's configured, and `/api/auth/sign-in/social` and the callback are reachable, but the flow has never been completed with a real Google client.
- **CloudFront.** Parsing `CloudFront-Viewer-Address` has unit tests only. Cookie forwarding and the body hash have not been exercised.
- **Load.** Rate limits are tested for behaviour, not under real traffic.
