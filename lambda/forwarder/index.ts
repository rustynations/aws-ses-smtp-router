import { createHash } from 'crypto';
import { S3Client, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { SESClient, SendRawEmailCommand, SendBounceCommand } from '@aws-sdk/client-ses';
import { resolveRoute, type RouterConfig } from './router';
import { rewriteEmail } from './rewriter';
import { validateConfig } from './validate';

const s3 = new S3Client({});
const ses = new SESClient({});

const BUCKET_NAME = process.env.BUCKET_NAME!;
const CONFIG_KEY = process.env.CONFIG_KEY!;
const MAX_EMAIL_SIZE = 10 * 1024 * 1024; // 10 MB

export async function handler(event: { Records: Array<{ ses: { mail: { messageId: string; source?: string }; receipt: { recipients: string[] } } }> }): Promise<void> {
  if (!event.Records?.length) {
    console.error('No records in SES event', JSON.stringify(event));
    return;
  }
  const record = event.Records[0];
  if (!record.ses?.receipt?.recipients?.length) {
    console.error('No recipients in SES record', JSON.stringify(record));
    return;
  }
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

  // Read config from S3 and verify integrity
  const configResponse = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET_NAME, Key: CONFIG_KEY })
  );
  const configBody = await configResponse.Body!.transformToString();

  const hashResponse = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET_NAME, Key: `${CONFIG_KEY}.sha256` })
  );
  const expectedHash = (await hashResponse.Body!.transformToString()).trim();
  const actualHash = createHash('sha256').update(configBody).digest('hex');

  if (actualHash !== expectedHash) {
    throw new Error(`Config integrity check failed: expected ${expectedHash}, got ${actualHash}`);
  }

  const config: RouterConfig = JSON.parse(configBody);
  validateConfig(config);

  // Resolve route
  const route = resolveRoute(config, recipient);
  const recipientDomain = recipient.substring(recipient.lastIndexOf('@') + 1);
  const mailFrom = record.ses.mail.source;

  // A bounce with no envelope sender degrades to a silent drop.
  const effectiveAction =
    route.action === 'bounce' && !mailFrom ? 'drop' : route.action;

  if (effectiveAction === 'drop') {
    console.warn(`Dropping ${recipient} (action=drop)`);
  } else if (effectiveAction === 'bounce') {
    console.log(`Bouncing ${recipient} back to ${mailFrom}`);
    await ses.send(
      new SendBounceCommand({
        OriginalMessageId: messageId,
        BounceSender: `noreply@${recipientDomain}`,
        Explanation: 'User unknown',
        MessageDsn: {
          ReportingMta: `dns; ${recipientDomain}`,
        },
        BouncedRecipientInfoList: [
          {
            Recipient: recipient,
            BounceType: 'DoesNotExist',
          },
        ],
      })
    );
  } else {
    // forward
    if (route.action !== 'forward') {
      throw new Error(`Unexpected route action: ${route.action}`);
    }
    console.log(`Forwarding ${recipient} → ${route.to}`);
    const rewrittenEmail = rewriteEmail({
      rawEmail,
      originalRecipient: recipient,
      recipientDomain,
    });
    await ses.send(
      new SendRawEmailCommand({
        RawMessage: { Data: Buffer.from(rewrittenEmail) },
        Destinations: [route.to],
      })
    );
    console.log(`Forwarded ${messageId} to ${route.to}`);
  }

  // Delete email from S3 (all terminal actions remove the stored message)
  await s3.send(
    new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: emailKey })
  );
}
