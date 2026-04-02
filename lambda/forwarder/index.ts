import { S3Client, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';
import { resolveRoute, type RouterConfig } from './router';
import { rewriteEmail } from './rewriter';

const s3 = new S3Client({});
const ses = new SESClient({});

const BUCKET_NAME = process.env.BUCKET_NAME!;
const CONFIG_KEY = process.env.CONFIG_KEY!;
const MAX_EMAIL_SIZE = 10 * 1024 * 1024; // 10 MB

export async function handler(event: { Records: Array<{ ses: { mail: { messageId: string }; receipt: { recipients: string[] } } }> }): Promise<void> {
  const record = event.Records[0];
  const messageId = record.ses.mail.messageId;
  const recipients = record.ses.receipt.recipients;
  const recipient = recipients[0];

  console.log(`Processing email ${messageId} for ${recipient}`);

  // Check email size before loading into memory
  const emailKey = `emails/${messageId}`;
  const head = await s3.send(
    new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: emailKey })
  );
  if (head.ContentLength && head.ContentLength > MAX_EMAIL_SIZE) {
    console.warn(`Email ${messageId} is ${head.ContentLength} bytes (limit ${MAX_EMAIL_SIZE}), deleting and skipping`);
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: emailKey }));
    return;
  }

  // Read raw email from S3
  const emailResponse = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET_NAME, Key: emailKey })
  );
  const rawEmail = await emailResponse.Body!.transformToString();

  // Detect forwarding loop
  if (rawEmail.includes('X-SES-Router-Forwarded: true')) {
    console.warn(`Email ${messageId} already forwarded by this router, deleting to prevent loop`);
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: emailKey }));
    return;
  }

  // Read config from S3
  const configResponse = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET_NAME, Key: CONFIG_KEY })
  );
  const config: RouterConfig = JSON.parse(await configResponse.Body!.transformToString());

  // Resolve route
  const forwardTo = resolveRoute(config, recipient);
  if (!forwardTo) {
    console.warn(`No route found for ${recipient}, skipping`);
    return;
  }

  console.log(`Forwarding ${recipient} → ${forwardTo}`);

  // Extract domain from recipient
  const recipientDomain = recipient.substring(recipient.lastIndexOf('@') + 1);

  // Rewrite email headers
  const rewrittenEmail = rewriteEmail({
    rawEmail,
    originalRecipient: recipient,
    recipientDomain,
  });

  // Send via SES
  await ses.send(
    new SendRawEmailCommand({
      RawMessage: { Data: Buffer.from(rewrittenEmail) },
      Destinations: [forwardTo],
    })
  );

  console.log(`Forwarded ${messageId} to ${forwardTo}`);

  // Delete email from S3
  await s3.send(
    new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: emailKey })
  );
}
