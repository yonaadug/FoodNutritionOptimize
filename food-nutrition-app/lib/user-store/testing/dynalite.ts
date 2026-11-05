import { createRequire } from 'node:module';
import { CreateTableCommand, DynamoDBClient, type CreateTableCommandInput } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoTable, type DynamoSender } from '../dynamo-table';

/**
 * DynamoTable against dynalite, an in-process DynamoDB server. The tests go through
 * the real AWS SDK and DynamoDB's own expression parsing and validation, with no
 * Docker and no AWS account. Unlike real DynamoDB, dynalite is strongly consistent
 * on GSIs and has no TTL reaper, which is fine here: reads filter expired items anyway.
 */
const require = createRequire(import.meta.url);

/** The table the app expects. docs/ACCOUNTS.md documents the same definition for CDK. */
const TABLE_DEFINITION: Omit<CreateTableCommandInput, 'TableName'> = {
    AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
        { AttributeName: 'GSI2PK', AttributeType: 'S' },
        { AttributeName: 'GSI2SK', AttributeType: 'S' },
    ],
    KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [
        {
            IndexName: 'GSI1',
            KeySchema: [{ AttributeName: 'GSI1PK', KeyType: 'HASH' }, { AttributeName: 'GSI1SK', KeyType: 'RANGE' }],
            Projection: { ProjectionType: 'ALL' },
        },
        {
            IndexName: 'GSI2',
            KeySchema: [{ AttributeName: 'GSI2PK', KeyType: 'HASH' }, { AttributeName: 'GSI2SK', KeyType: 'RANGE' }],
            Projection: { ProjectionType: 'ALL' },
        },
    ],
    BillingMode: 'PAY_PER_REQUEST',
};

export interface DynaliteHarness {
    table: DynamoTable;
    client: DynamoSender;
    endpoint: string;
    close(): Promise<void>;
}

export async function startDynalite(tableName = 'test-table'): Promise<DynaliteHarness> {
    const dynalite = require('dynalite') as (options: Record<string, unknown>) => {
        listen(port: number, host: string, cb: (err?: Error) => void): void;
        address(): { port: number };
        close(cb: () => void): void;
    };
    const server = dynalite({ createTableMs: 0, deleteTableMs: 0, updateTableMs: 0 });
    await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', err => (err ? reject(err) : resolve())));
    const endpoint = `http://127.0.0.1:${server.address().port}`;

    const raw = new DynamoDBClient({ endpoint, region: 'us-east-1', credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
    await raw.send(new CreateTableCommand({ TableName: tableName, ...TABLE_DEFINITION }));
    const client = DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } }) as unknown as DynamoSender;

    return {
        table: new DynamoTable(client, tableName),
        client,
        endpoint,
        close: async () => {
            raw.destroy();
            await new Promise<void>(resolve => server.close(() => resolve()));
        },
    };
}
