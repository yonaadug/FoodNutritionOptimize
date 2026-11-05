import path from 'node:path';
import type { SingleTable } from './table';
import { UserStore } from './user-store';

/**
 * Picks the backend from the environment. Nothing here runs until the first account
 * request, so anonymous pages never open a database or load the AWS SDK.
 *
 *   USER_STORE=sqlite     writable SQLite file at APP_DB_PATH (default .data/app.db)
 *   USER_STORE=dynamodb   DynamoDB table DYNAMODB_TABLE (optional AWS_REGION, DYNAMODB_ENDPOINT)
 *
 * The default is sqlite, except on Lambda: its filesystem is read-only, so there
 * the default is dynamodb.
 */

export class UserStoreConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UserStoreConfigError';
    }
}

/** `npm run preview` runs from .next/standalone, which a rebuild wipes, so keep data beside the app. */
export function defaultAppDbPath(cwd = process.cwd()): string {
    const marker = `${path.sep}.next${path.sep}standalone`;
    const base = cwd.endsWith(marker) ? cwd.slice(0, -marker.length) : cwd;
    return path.join(base, '.data', 'app.db');
}

async function createTable(env: NodeJS.ProcessEnv): Promise<SingleTable> {
    const backend = env.USER_STORE || (env.AWS_LAMBDA_FUNCTION_NAME ? 'dynamodb' : 'sqlite');
    if (backend === 'dynamodb') {
        if (!env.DYNAMODB_TABLE) throw new UserStoreConfigError('USER_STORE=dynamodb requires DYNAMODB_TABLE');
        const { createDynamoClient, DynamoTable } = await import('./dynamo-table');
        const client = createDynamoClient({ region: env.AWS_REGION, endpoint: env.DYNAMODB_ENDPOINT });
        return new DynamoTable(client, env.DYNAMODB_TABLE);
    }
    if (backend !== 'sqlite') throw new UserStoreConfigError(`Unknown USER_STORE "${backend}" (use sqlite or dynamodb)`);
    const file = env.APP_DB_PATH || defaultAppDbPath();
    // A cheap guard against the one mistake that must never happen.
    if (path.basename(file) === 'nutrition.db') throw new UserStoreConfigError('APP_DB_PATH must not point at nutrition.db');
    const { SqliteTable } = await import('./sqlite-table');
    return new SqliteTable(file);
}

// Survives Next's hot reloads in dev, so one process keeps one connection.
const globals = globalThis as unknown as { __mdUserTable?: Promise<SingleTable> };

export function getTable(): Promise<SingleTable> {
    if (!globals.__mdUserTable) {
        globals.__mdUserTable = createTable(process.env).catch(e => {
            globals.__mdUserTable = undefined; // let the next request retry
            throw e;
        });
    }
    return globals.__mdUserTable;
}

export async function getUserStore(): Promise<UserStore> {
    return new UserStore(await getTable());
}
