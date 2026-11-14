/**
 * Start script for the Lambda image (Dockerfile.lambda runs `node /opt/secrets/start.mjs`).
 *
 * The app reads its secrets (AUTH_SECRET, GOOGLE_CLIENT_*, Stripe keys) from plain
 * environment variables. CloudFormation can't put an SSM SecureString into a Lambda
 * environment, and copying the value in at deploy time would show it in the Lambda
 * console. So the CDK stack passes only the parameter *names*, in SSM_SECRETS:
 *
 *   SSM_SECRETS=AUTH_SECRET=/nutrition-dictionary/dev/auth/secret,GOOGLE_CLIENT_ID=/nutrition-dictionary/dev/auth/google-client-id
 *
 * and this script reads them once per cold start (GetParameters, decrypted), sets
 * process.env, then starts the Next.js standalone server in the same process.
 *
 * - A variable that is already set is left alone, so a plain `docker run -e AUTH_SECRET=...`
 *   still works, and with no SSM_SECRETS nothing is read at all.
 * - A parameter that doesn't exist yet is skipped with a warning naming it. The feature
 *   that needs it stays off (no Google button, no Stripe), and the site still starts.
 * - Values are never logged.
 */
import { pathToFileURL } from 'node:url';

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const BATCH = 10; // GetParameters accepts at most 10 names per call

/** "A=/x/a, B=/x/b" -> [["A", "/x/a"], ["B", "/x/b"]]. Throws on a malformed entry. */
export function parseSpec(spec) {
    return (spec ?? '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(entry => {
            const i = entry.indexOf('=');
            const name = entry.slice(0, i).trim();
            const param = entry.slice(i + 1).trim();
            if (i <= 0 || !ENV_NAME.test(name) || !param.startsWith('/')) {
                throw new Error(`SSM_SECRETS entry "${entry}" must look like ENV_NAME=/parameter/name`);
            }
            return [name, param];
        });
}

/**
 * Copies the parameters named in env.SSM_SECRETS into env.
 * `send` is an SSM client's send(command); injected so tests need no AWS.
 * Returns what happened, by name only.
 */
export async function loadSecrets(env, send, makeCommand) {
    const wanted = parseSpec(env.SSM_SECRETS).filter(([name]) => !env[name]);
    const loaded = [];
    const missing = [];
    for (let i = 0; i < wanted.length; i += BATCH) {
        const chunk = wanted.slice(i, i + BATCH);
        const res = await send(makeCommand({ Names: [...new Set(chunk.map(([, p]) => p))], WithDecryption: true }));
        const values = new Map((res.Parameters ?? []).map(p => [p.Name, p.Value]));
        for (const [name, param] of chunk) {
            const value = values.get(param);
            if (value) {
                env[name] = value;
                loaded.push(name);
            } else {
                missing.push(param);
            }
        }
    }
    return { loaded, missing };
}

async function main() {
    if (process.env.SSM_SECRETS) {
        const started = Date.now();
        try {
            const { SSMClient, GetParametersCommand } = await import('@aws-sdk/client-ssm');
            const client = new SSMClient({});
            const { loaded, missing } = await loadSecrets(
                process.env,
                command => client.send(command, { abortSignal: AbortSignal.timeout(5000) }),
                input => new GetParametersCommand(input),
            );
            console.info(`[secrets] loaded ${loaded.length ? loaded.join(', ') : 'nothing'} from SSM in ${Date.now() - started} ms`);
            for (const param of missing) console.warn(`[secrets] SSM parameter ${param} does not exist yet; the feature that needs it stays off`);
        } catch (e) {
            // Start anyway: food pages and the planner need no secrets. Sign-in reports
            // itself unavailable until AUTH_SECRET can be read.
            console.error(`[secrets] could not read SSM parameters (${e?.name ?? 'Error'}: ${e?.message ?? e}); starting without them`);
        }
    }
    await import(pathToFileURL(process.env.SERVER_ENTRY || '/app/server.js').href);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    await main();
}
