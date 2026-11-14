# Testing everything locally (before AWS)

This is the checklist for testing every way NutritionDictionary ships, on a Mac laptop,
before anything goes to AWS. Work through it top to bottom. Each step lists the command
(a `make` target from the repo root, with the plain npm/docker equivalent) and what you
should see. If a step fails, see [Troubleshooting](#troubleshooting).

| # | What | Command | Needs |
|---|---|---|---|
| 0 | Prerequisites | | Node 26, git-lfs, Docker Desktop |
| 1 | Install | `./setup.sh --with-electron` | |
| 2 | Everything CI checks | `make check` | |
| 3 | Dev server + click-through | `make dev` | browser |
| 4 | Production build (standalone server) | `make preview` + `make smoke` | |
| 5 | Docker image | `make docker-test` | Docker |
| 6 | Lambda image | `make lambda-local` | Docker |
| 7 | AWS infrastructure (CDK synth) | `make cdk-synth` | nothing (no AWS account) |
| 8 | Desktop app (dev) | `make desktop` | |
| 9 | Desktop app (packaged) | `make desktop-pack`, then open the app | |

Steps 1–4 and 7–9 take about 5 minutes together. Steps 5–6 add a few minutes the first
time while Docker downloads base images.

`make smoke` (`food-nutrition-app/scripts/smoke.mjs`) is the same HTTP check everywhere:
locally, against Docker, against the Lambda image and in CI. It requests the page,
`GET /api/meta`, `GET /api/search?q=salmon`, and runs `POST /api/optimize` twice.

---

## 0. Prerequisites

```bash
node -v          # v26.x (current LTS). v24 also works; `nvm install` reads .nvmrc
git lfs version  # git-lfs/3.x
docker version   # Server: ... (only for steps 5-6; start Docker Desktop first)
```

The food database (`food-nutrition-app/nutrition.db`, about 6.9 MB) is stored in Git LFS.
`setup.sh` fetches it for you.

## 1. Install

```bash
./setup.sh --with-electron
```

Expected (last lines):

```
✔ Node.js v26.x
✔ npm 11.x
✔ Database: food-nutrition-app/nutrition.db (6.6M)
foods in DB: 9435
✔ Web app ready
✔ Desktop app ready (cd electron-app && npm start)
Setup complete.
```

`npm warn deprecated eslint@9.39.5` is expected; see the note on ESLint 10 in
[Troubleshooting](#troubleshooting). The CDK example installs separately (`make cdk-synth` runs `npm ci` itself).

## 2. Everything CI checks

```bash
make check                  # = cd food-nutrition-app && npm run check
```

This runs lint, `next typegen && tsc --noEmit`, the unit tests and `next build` in that
order and stops at the first failure. Expected:

```
> eslint .                       (no output = no problems)
> next typegen && tsc --noEmit
✓ Types generated successfully
ℹ tests 139
ℹ pass 139
ℹ fail 0
▲ Next.js 16.4.5 (Turbopack)
✓ Compiled successfully
Route (app)
┌ ○ /
├ ƒ /api/food  ...  └ ƒ /api/search
```

## 3. Dev server + click-through

```bash
make dev                    # = next dev --hostname 127.0.0.1 --port 3000
```

Open http://127.0.0.1:3000 (http://localhost:3000 works too) and check:

1. **Try a sample day** opens "Your plan" with **Every goal met** (about 1,800 kcal, 9 foods).
2. Reload, choose **Start with my own foods**, search `salmon`, `rice`, `broccoli` and add one
   of each. The bar at the bottom shows "3 foods".
3. **Set goals**, then **Make my plan**. You get a plan, or "Couldn't meet every goal" with
   suggestions. Both mean the optimizer ran.
4. Toggle dark mode (top right). Stop the server with Ctrl+C.

## 4. Production build: the standalone server

Docker, Lambda and the desktop app all run `.next/standalone/server.js`, not `next start`,
so test that:

```bash
make preview                # = cd food-nutrition-app && npm run preview  (build + run)
# in a second terminal:
make smoke                  # = node food-nutrition-app/scripts/smoke.mjs http://127.0.0.1:3000
```

Expected from `make smoke`:

```
Smoke testing http://127.0.0.1:3000
  ok  GET / - 200, 15888 bytes of HTML
  ok  GET /api/meta - 9435 foods, search mode fts
  ok  GET /api/search?q=salmon - 56 matches, first: "Fish, salmon, sockeye, wild caught, raw"
  ok  POST /api/optimize (default goals) - infeasible with diagnosis (• Cannot meet Vitamin E target ...)
  ok  POST /api/optimize (relaxed goals) - 3 foods, 1000 kcal, 87 g protein
All 5 smoke checks passed.
```

The "infeasible" line is correct: five foods can't cover every daily value, and the check
only requires a diagnosis. The second request must find a plan.

The bundle is self-contained and doesn't depend on the current directory:

```bash
cd /tmp && PORT=3300 node ~/path/to/repo/food-nutrition-app/.next/standalone/server.js
# then: make smoke URL=http://127.0.0.1:3300
```

(`npm start`, which is `next start`, also works but prints
`"next start" does not work with "output: standalone"`. Use `preview` instead.)

## 5. Docker image

Start Docker Desktop and wait until `docker version` shows a `Server:` section. Then:

```bash
make docker-test            # build, run detached, wait for HEALTHCHECK, smoke test, remove
```

Expected: the build ends with `naming to docker.io/library/nutrition-dictionary`, then
`container health: healthy` and the same `All 5 smoke checks passed.` as step 4. The
container is removed afterwards.

To click around in it instead: `make docker` (= `docker build -t nutrition-dictionary . &&
docker run --rm -it -p 3000:3000 nutrition-dictionary`), open http://127.0.0.1:3000,
Ctrl+C to stop.

The image builds for your Mac's architecture (arm64 on Apple silicon). For an x86_64
server, build with `docker build --platform linux/amd64 ...`.

## 6. Lambda image (the AWS shape)

`docs/aws/infra-example/Dockerfile.lambda` is the image the CDK example deploys: the same
standalone server plus [AWS Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter)
1.1.0 in `/opt/extensions`. The adapter only starts inside the Lambda execution environment.
Run as a plain container it does nothing, and the Next.js server answers HTTP directly,
so the HTTP behaviour can be tested with `docker run`.

```bash
make lambda-local           # arm64, like the CDK example's function
```

That target:

```bash
docker build --platform linux/arm64 -f docs/aws/infra-example/Dockerfile.lambda -t nutrition-dictionary-lambda .
docker run -d --name nutrition-dictionary-lambda --platform linux/arm64 -p 9000:3000 \
  --read-only --tmpfs /tmp --memory 1024m --user 993:990 nutrition-dictionary-lambda
node food-nutrition-app/scripts/smoke.mjs http://127.0.0.1:9000 --wait 60
docker rm -f nutrition-dictionary-lambda
```

`--read-only --tmpfs /tmp` matches Lambda's read-only filesystem with a writable `/tmp`,
`--user` runs it as a non-root uid (Lambda doesn't run as root), and `--memory` matches the
function's 1024 MB. Expected: `All 5 smoke checks passed.` on port 9000.

To check by hand while it runs (`docker run ... -p 9000:3000 nutrition-dictionary-lambda`):

```bash
curl -s http://127.0.0.1:9000/api/meta                       # {"meta":{...},"searchMode":"fts","foodCount":9435}
curl -s 'http://127.0.0.1:9000/api/search?q=salmon&limit=3'  # {"foods":[{"description":"Fish, salmon, sockeye, ...
curl -s -X POST http://127.0.0.1:9000/api/optimize -H 'content-type: application/json' \
  -d '{"foods":[{"id":147}],"minCalories":200,"maxCalories":2000}'
# {"success":false,"message":"Optimization Failed:\n• Cannot meet Fiber target ...  (one food can't meet
# every default goal; a diagnosis means the solver ran. 147 = the salmon from the search above)
docker exec <container> ls /opt/extensions                   # lambda-adapter
```

`docker images` shows about 356 MB for the Lambda image and 305 MB for the plain one.

**arm64 vs x86_64.** The CDK example deploys an **arm64** function (cheaper per ms). On an
Apple-silicon Mac `linux/arm64` runs natively. To test an x86_64 build, run
`make lambda-local LAMBDA_PLATFORM=linux/amd64`. Docker Desktop emulates it (Rosetta when
"Use Rosetta for x86_64/amd64 emulation" is on in Settings > General, otherwise QEMU).
Expect a slower build and startup: with Rosetta and a warm cache, the amd64 build plus
smoke test took about 70 seconds on an M-series Mac.
`docker image inspect -f '{{.Architecture}}' nutrition-dictionary-lambda` shows which one you built. If you switch the function to x86_64, change both
`ecrAssets.Platform.LINUX_AMD64` and `lambda.Architecture.X86_64` in the stack. Always build
the image for the target platform: the better-sqlite3 binary in the bundle is the build
stage's.

**What this doesn't cover:** the Lambda event round trip (Function URL event → adapter →
HTTP → response) and cold starts. See [Not testable locally](#what-cant-be-tested-locally).

## 7. AWS infrastructure: CDK synth

```bash
make cdk-synth              # npm ci + tsc --noEmit + cdk synth for dev and prod
```

This needs no AWS account or credentials: the example uses no context lookups, and synth
only *stages* the Docker build context (it builds nothing). Expected:

```
> tsc --noEmit
Successfully synthesized to .../docs/aws/infra-example/cdk/cdk.out
Successfully synthesized to .../docs/aws/infra-example/cdk/cdk.out
```

The CLI also prints `85 feature flags are not configured` (informational), a warning that
`synthOnly` subscribes no alert email (expected: a real deploy passes `ALERT_EMAIL`, see
[DEPLOY.md](DEPLOY.md)), and may print "AI agent detected" (harmless). To read the generated
CloudFormation: `cd docs/aws/infra-example/cdk && npx cdk synth NutritionDictionary-dev -c synthOnly=true | less`.
The stacks are `NutritionDictionaryDns-{dev,prod}`, `NutritionDictionary-{dev,prod}` and
`GithubOidc-{dev,prod}`.

To check that the staged image context builds, as `cdk deploy` will build it:

```bash
cd docs/aws/infra-example/cdk/cdk.out/asset.<hash>    # the dockerImages entry in NutritionDictionary-dev.assets.json
docker build --platform linux/arm64 -f docs/aws/infra-example/Dockerfile.lambda .
```

The AI-worker handler in `cdk/workers/` is a **placeholder** so the example bundles. The
Stripe webhook runs the app's own route in the same image. The image's start script, which
reads SSM secrets, has its own tests: `cd docs/aws/infra-example/lambda-secrets && npm ci && npm test`.

## 8. Desktop app (dev)

```bash
make desktop                # = cd electron-app && npm start
```

A window titled "NutritionDictionary" opens after a few seconds (it starts `next dev` on a
random `127.0.0.1` port). Repeat the click-through from step 3. Closing the window leaves
the app in the Dock (macOS behaviour); quit it with ⌘Q. The log is at
`~/Library/Logs/NutritionDictionary/main.log` and should contain `Server is ready` with no
`Blocked` or `FATAL` lines.

## 9. Desktop app (packaged)

```bash
make desktop-pack           # = cd electron-app && npm run pack  (build + stage + electron-builder --dir)
open "electron-app/dist/mac-arm64/NutritionDictionary.app"
```

Expected from the pack step: `[stage-web] Staged Next.js standalone server into
.../electron-app/staging/web`, then `packaging platform=darwin arch=arm64 electron=45.2.2`.
If a Developer ID or Apple Development certificate is in your keychain, electron-builder
signs with it automatically; notarization is skipped. The app opens without Node installed. Its log
(`~/Library/Logs/NutritionDictionary/main.log`) shows `packaged=true, dev=false` and
`Starting standalone server from .../Contents/Resources/web`. Try a sample day, then quit
with ⌘Q.

Installers: `npm run build:mac` (dmg + zip) in `electron-app/`.

---

## Troubleshooting

**`nutrition.db is not a SQLite file (Git LFS pointer?)`**: run `git lfs install && git lfs pull`.
`head -c 15 food-nutrition-app/nutrition.db` must print `SQLite format 3`.

**Port 3000 already in use**: `lsof -nP -iTCP:3000 -sTCP:LISTEN` shows who has it. Use
another port: `make dev PORT=3100`, `make preview PORT=3100` then `make smoke URL=http://127.0.0.1:3100`.

**Dev page loads but buttons do nothing**: Next 16 blocks dev resources for origins other
than `localhost` unless they are listed in `allowedDevOrigins`. `next.config.js` allows
`127.0.0.1`. If you open the dev server through another host name (LAN IP, a tunnel), add it there.

**The packaged app or `electron .` prints `bad option: --...` and exits**: your shell has
`ELECTRON_RUN_AS_NODE=1` set (some editors' terminals set it), which makes Electron run as
plain Node. `unset ELECTRON_RUN_AS_NODE`. The npm scripts already do this.

**macOS says the app "can't be opened"**: local builds aren't notarized. Right-click the
app, choose Open, then Open again (or `xattr -dr com.apple.quarantine "NutritionDictionary.app"`
on a copy you downloaded).

**`better-sqlite3` fails to load** (`invalid ELF header`, `wrong architecture`): the bundle
contains the native binary for the platform it was *built* on. Rebuild on, or with
`--platform` for, the target. Don't copy `node_modules` or `.next/standalone` between Mac
and Linux.

**Docker: `Cannot connect to the Docker daemon` / `500 Internal Server Error` on every
command**: Docker Desktop is still starting or its VM has no network. Wait until
`docker version` shows a `Server:` section. If it stays broken, check
`~/Library/Containers/com.docker.docker/Data/log/vm/init.log`. Repeated
`still waiting for eth0` / `DHCPv4 failure` lines mean the VM has no network. This
happened on Docker Desktop 4.58.1 and went away once Docker Desktop updated itself to
4.98.0. Update Docker Desktop first. If that doesn't help, quit it, temporarily disconnect
VPNs (e.g. Tailscale) and start it again.

**amd64 builds are very slow**: that's emulation. Turn on Rosetta in Docker Desktop
(Settings > General) or build arm64.

**`npm warn deprecated eslint@9.39.5`**: expected. ESLint 10 is out, but the React, import and
jsx-a11y plugins bundled by `eslint-config-next` 16.4.5 still declare `eslint <= 9`.
A trial run with ESLint 10 reported the same findings; we stay on 9 until those plugins
update.

**`npm warn install-scripts ... not yet covered by allowScripts`** (npm 11): informational.
The web app installs with `--ignore-scripts` anyway (better-sqlite3 ships prebuilt binaries);
Electron's binary still downloads; esbuild works without its postinstall.

**`cdk synth` fails with `Cannot find file at .../Dockerfile.lambda`**: run it from
`docs/aws/infra-example/cdk/`. The stack resolves the repo root relative to its own file,
and the root `.dockerignore` must keep the `!docs/aws/infra-example/Dockerfile.lambda` line.

---

## What can't be tested locally

| Piece | Why not | Cheapest real test |
|---|---|---|
| **CloudFront** (cache behaviours, compression, HTTP/3, origin access control signing to the Function URL, the `x-amz-content-sha256` requirement on POST) | Needs the AWS edge | Deploy the dev stack; `curl -I $SiteUrl/api/search?q=apple` twice and look for `x-cache: Hit from cloudfront`; POST through CloudFront with and without the hash header |
| **Lambda Function URL + IAM auth** | AWS-signed requests | Same dev deploy. A direct, unsigned request to the Function URL must return 403 |
| **Lambda Web Adapter event translation, real cold starts, memory/timeouts, reserved concurrency** | Locally the adapter is idle; Lambda runs your container its own way | Dev deploy, then CloudWatch Logs `INIT_START` / `REPORT ... Init Duration`; force a cold start by changing an env var |
| **Cognito** (sign-up email, OTP, hosted flows) | AWS service | Dev user pool. Default Cognito email works for a handful of test sign-ups a day |
| **DynamoDB, SQS, SSM, SES, Budgets, alarms, kill switch** | AWS services (the app doesn't use them yet) | Dev deploy. Publish a test message to the kill-switch SNS topic and check that the AI flag flips |
| **Custom domain / ACM / DNS** | Needs the real domain | Do last, in prod only |

**A cheap dev-account test, once you're ready:**

1. Use a **separate AWS account** for dev (an AWS Organizations member account), with a
   $5 budget alert. The stack also creates one.
2. `cd docs/aws/infra-example/cdk`, set `alertEmail` in `bin/nutrition-dictionary.ts`, then:
   `npx cdk bootstrap aws://<DEV_ACCOUNT_ID>/us-east-1` (once), `npx cdk diff -c stage=dev NutritionDictionary-dev`,
   `npx cdk deploy -c stage=dev NutritionDictionary-dev`. Docker must be running: deploy builds the arm64 image.
3. Run `make smoke URL=<SiteUrl output>`. Through CloudFront the POST checks need the OAC
   hash header, so start with the GET checks: `curl $SiteUrl/api/meta`.
4. When you're done, run `npx cdk destroy -c stage=dev NutritionDictionary-dev` (dev resources use
   `RemovalPolicy.DESTROY`). An idle dev stack costs close to $0. CloudFront, Lambda,
   DynamoDB on-demand and Cognito are all free or nearly free at test volumes.

To emulate the Lambda *invoke* path without AWS, you can try the
[Lambda Runtime Interface Emulator](https://github.com/aws/aws-lambda-runtime-interface-emulator)
or `sam local start-api`. Neither is set up in this repo, and neither reproduces CloudFront,
IAM or cold starts.

Before you deploy anything, note that AWS launched
[Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html) (Node.js,
October 2026). They serve HTTP natively without the adapter, and the Lambda Web Adapter
README now recommends them for new Node.js web apps. That could simplify
`docs/aws/AWS_HOSTING_DESIGN.md` Option A, so compare the two before deploying.
