import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    BatchWriteCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
    decodeCursor, encodeCursor, indexAttrs, InvalidCursorError, isLive, nowSeconds,
    type ItemKey, type PutOptions, type QueryOptions, type QueryPage, type SingleTable, type TableItem,
} from './table';

/**
 * SingleTable on DynamoDB (production): on-demand table with PK/SK, sparse GSI1 and
 * GSI2 (both projecting ALL) and TTL on `expiresAt`. docs/ACCOUNTS.md has the setup.
 *
 * Authentication comes from the default AWS credential chain (the Lambda role),
 * so there are no keys to store.
 */
export interface DynamoSender {
    send(command: unknown): Promise<any>;
}

type BatchRequest = { DeleteRequest: { Key: Record<string, string> } };

const isConditionFailure = (e: unknown) => (e as { name?: string })?.name === 'ConditionalCheckFailedException';

export function createDynamoClient(options: { region?: string; endpoint?: string } = {}): DynamoSender {
    const client = new DynamoDBClient({
        ...(options.region ? { region: options.region } : {}),
        ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    });
    return DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } }) as unknown as DynamoSender;
}

export class DynamoTable implements SingleTable {
    readonly kind = 'dynamodb' as const;
    private client: DynamoSender;
    private tableName: string;

    constructor(client: DynamoSender, tableName: string) {
        this.client = client;
        this.tableName = tableName;
    }

    async get(key: ItemKey): Promise<TableItem | null> {
        const res = await this.client.send(new GetCommand({
            TableName: this.tableName,
            Key: { PK: key.PK, SK: key.SK },
            ConsistentRead: true,
        }));
        const item = res.Item as TableItem | undefined;
        return item && isLive(item) ? item : null;
    }

    async put(item: TableItem, options: PutOptions = {}): Promise<boolean> {
        const now = nowSeconds();
        const values: Record<string, unknown> = {};
        const names: Record<string, string> = {};
        let condition: string | undefined;
        let version = (item._v ?? 0) + 1;
        if (options.ifNotExists) {
            condition = 'attribute_not_exists(PK) OR expiresAt <= :now';
            values[':now'] = now;
            version = 1;
        } else if (options.ifVersion !== undefined) {
            condition = '#v = :v AND (attribute_not_exists(expiresAt) OR expiresAt > :now)';
            names['#v'] = '_v';
            values[':v'] = options.ifVersion;
            values[':now'] = now;
            version = options.ifVersion + 1;
        }
        try {
            await this.client.send(new PutCommand({
                TableName: this.tableName,
                Item: { ...item, _v: version },
                ...(condition ? { ConditionExpression: condition, ExpressionAttributeValues: values } : {}),
                ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
            }));
            return true;
        } catch (e) {
            if (isConditionFailure(e)) return false;
            throw e;
        }
    }

    async take(key: ItemKey, options: { ifVersion?: number } = {}): Promise<TableItem | null> {
        const versioned = options.ifVersion !== undefined;
        try {
            const res = await this.client.send(new DeleteCommand({
                TableName: this.tableName,
                Key: { PK: key.PK, SK: key.SK },
                ReturnValues: 'ALL_OLD',
                ConditionExpression: versioned ? 'attribute_exists(PK) AND #v = :v' : 'attribute_exists(PK)',
                ...(versioned ? { ExpressionAttributeNames: { '#v': '_v' }, ExpressionAttributeValues: { ':v': options.ifVersion } } : {}),
            }));
            const old = res.Attributes as TableItem | undefined;
            return old && isLive(old) ? old : null;
        } catch (e) {
            if (isConditionFailure(e)) return null;
            throw e;
        }
    }

    async query(options: QueryOptions): Promise<QueryPage> {
        const { pk: pkAttr, sk: skAttr } = indexAttrs(options.index);
        const limit = Math.max(1, Math.min(options.limit ?? 100, 1000));
        const scope = `${options.index ?? 'T'}:${options.pk}`;
        const names: Record<string, string> = { '#pk': pkAttr };
        const values: Record<string, unknown> = { ':pk': options.pk, ':now': nowSeconds() };
        let keyCondition = '#pk = :pk';
        if (options.skPrefix) {
            names['#sk'] = skAttr;
            values[':prefix'] = options.skPrefix;
            keyCondition += ' AND begins_with(#sk, :prefix)';
        }
        let startKey: Record<string, string> | undefined;
        if (options.cursor) {
            const pos = decodeCursor(options.cursor, scope);
            if (options.index) {
                if (!pos.ik || !pos.pk || !pos.sk) throw new InvalidCursorError();
                startKey = { PK: pos.pk, SK: pos.sk, [pkAttr]: options.pk, [skAttr]: pos.ik };
            } else {
                if (!pos.sk) throw new InvalidCursorError();
                startKey = { PK: options.pk, SK: pos.sk };
            }
        }
        // Read limit + 1 live items so "is there another page?" has the same answer as SQLite.
        // TTL deletes lazily, so expired items are filtered and a page can need several reads.
        const items: TableItem[] = [];
        do {
            let res;
            try {
                res = await this.client.send(new QueryCommand({
                    TableName: this.tableName,
                    ...(options.index ? { IndexName: options.index } : { ConsistentRead: true }),
                    KeyConditionExpression: keyCondition,
                    FilterExpression: 'attribute_not_exists(expiresAt) OR expiresAt > :now',
                    ExpressionAttributeNames: names,
                    ExpressionAttributeValues: values,
                    ScanIndexForward: !options.descending,
                    Limit: limit + 1 - items.length,
                    ...(startKey ? { ExclusiveStartKey: startKey } : {}),
                }));
            } catch (e) {
                if (options.cursor && (e as { name?: string })?.name === 'ValidationException') throw new InvalidCursorError();
                throw e;
            }
            items.push(...((res.Items ?? []) as TableItem[]));
            startKey = res.LastEvaluatedKey;
        } while (startKey && items.length <= limit);

        if (items.length <= limit) return { items };
        const page = items.slice(0, limit);
        const last = page[page.length - 1];
        const position: Record<string, string> = options.index
            ? { ik: String(last[skAttr] ?? ''), pk: last.PK, sk: last.SK }
            : { sk: last.SK };
        return { items: page, cursor: encodeCursor(scope, position) };
    }

    async increment(key: ItemKey, by: number, ttlSeconds?: number): Promise<number> {
        for (let attempt = 0; attempt < 4; attempt++) {
            const now = nowSeconds();
            try {
                const res = await this.client.send(new UpdateCommand({
                    TableName: this.tableName,
                    Key: { PK: key.PK, SK: key.SK },
                    UpdateExpression: 'ADD #count :by, #v :one',
                    ConditionExpression: 'attribute_exists(PK) AND (attribute_not_exists(expiresAt) OR expiresAt > :now)',
                    ExpressionAttributeNames: { '#count': 'count', '#v': '_v' },
                    ExpressionAttributeValues: { ':by': by, ':one': 1, ':now': now },
                    ReturnValues: 'UPDATED_NEW',
                }));
                return Number(res.Attributes?.count);
            } catch (e) {
                if (!isConditionFailure(e)) throw e;
            }
            // Missing or expired: start a new window. If another request just did, go round again.
            try {
                await this.client.send(new PutCommand({
                    TableName: this.tableName,
                    Item: { PK: key.PK, SK: key.SK, count: by, _v: 1, ...(ttlSeconds ? { expiresAt: now + ttlSeconds } : {}) },
                    ConditionExpression: 'attribute_not_exists(PK) OR expiresAt <= :now',
                    ExpressionAttributeValues: { ':now': now },
                }));
                return by;
            } catch (e) {
                if (!isConditionFailure(e)) throw e;
            }
        }
        throw new Error('DynamoTable.increment: too much contention');
    }

    async deleteMany(keys: ItemKey[]): Promise<void> {
        for (let i = 0; i < keys.length; i += 25) {
            let requests: BatchRequest[] | undefined = keys.slice(i, i + 25).map(k => ({ DeleteRequest: { Key: { PK: k.PK, SK: k.SK } } }));
            for (let attempt = 0; requests?.length; attempt++) {
                if (attempt > 8) throw new Error('DynamoTable.deleteMany: unprocessed items after retries');
                if (attempt > 0) await new Promise(r => setTimeout(r, 50 * 2 ** attempt));
                const res: { UnprocessedItems?: Record<string, BatchRequest[]> } = await this.client.send(new BatchWriteCommand({
                    RequestItems: { [this.tableName]: requests },
                }));
                requests = res.UnprocessedItems?.[this.tableName];
            }
        }
    }
}
