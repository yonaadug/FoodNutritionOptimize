/**
 * PLACEHOLDER AI import worker (SQS -> Claude -> DynamoDB). Exists so the CDK
 * example synthesizes and bundles; replace with the real handler described in
 * docs/aws/AWS_HOSTING_DESIGN.md before deploying anything that uses it.
 */
interface SqsRecord {
  messageId: string;
  body: string;
}

export async function handler(event: { Records?: SqsRecord[] }): Promise<{ batchItemFailures: { itemIdentifier: string }[] }> {
  for (const record of event.Records ?? []) {
    console.log(JSON.stringify({ msg: 'import worker placeholder: message ignored', messageId: record.messageId }));
  }
  return { batchItemFailures: [] };
}
