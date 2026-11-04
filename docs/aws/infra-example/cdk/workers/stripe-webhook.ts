/**
 * PLACEHOLDER Stripe webhook (Lambda Function URL). Exists so the CDK example
 * synthesizes and bundles. It rejects every request: the real handler must
 * verify the Stripe-Signature header against the webhook secret in SSM before
 * trusting any payload (see docs/aws/AWS_HOSTING_DESIGN.md).
 */
export async function handler(): Promise<{ statusCode: number; body: string }> {
  return { statusCode: 501, body: 'stripe webhook not implemented' };
}
