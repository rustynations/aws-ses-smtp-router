import { createHash } from 'crypto';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { SESClient, SendRawEmailCommand, SendBounceCommand } from '@aws-sdk/client-ses';
import { Readable } from 'stream';
import { sdkStreamMixin } from '@smithy/util-stream';

const s3Mock = mockClient(S3Client);
const sesMock = mockClient(SESClient);

// Set env vars before importing handler
process.env.BUCKET_NAME = 'test-bucket';
process.env.CONFIG_KEY = 'config/config.json';

import { handler } from '../../lambda/forwarder/index';

const RAW_EMAIL = [
  'From: "Test Sender" <sender@external.com>',
  'To: info@example.com',
  'Subject: Hello',
  'Content-Type: text/plain',
  '',
  'Test body',
].join('\r\n');

const CONFIG_JSON = JSON.stringify({
  defaultForwardTo: 'default@gmail.com',
  domains: {
    'example.com': {
      catchAll: 'catch@gmail.com',
      routes: {
        'sales@example.com': 'sales@gmail.com',
      },
    },
  },
});

function makeSesEvent(messageId: string, recipients: string[], source = 'sender@external.com') {
  return {
    Records: [
      {
        ses: {
          mail: { messageId, source },
          receipt: { recipients },
        },
      },
    ],
  };
}

const CONFIG_HASH = createHash('sha256').update(CONFIG_JSON).digest('hex');

function toSdkStream(content: string) {
  const stream = new Readable();
  stream.push(content);
  stream.push(null);
  return sdkStreamMixin(stream);
}

beforeEach(() => {
  s3Mock.reset();
  sesMock.reset();

  s3Mock.on(HeadObjectCommand, { Key: 'emails/abc123' }).resolves({
    ContentLength: RAW_EMAIL.length,
  });
  s3Mock.on(GetObjectCommand, { Key: 'emails/abc123' }).resolves({
    Body: toSdkStream(RAW_EMAIL),
  });
  s3Mock.on(GetObjectCommand, { Key: 'config/config.json' }).resolves({
    Body: toSdkStream(CONFIG_JSON),
  });
  s3Mock.on(GetObjectCommand, { Key: 'config/config.json.sha256' }).resolves({
    Body: toSdkStream(CONFIG_HASH),
  });
  sesMock.on(SendRawEmailCommand).resolves({ MessageId: 'sent-123' });
  s3Mock.on(DeleteObjectCommand).resolves({});
});

describe('handler', () => {
  test('forwards email to catch-all destination', async () => {
    await handler(makeSesEvent('abc123', ['info@example.com']));

    const sendCalls = sesMock.commandCalls(SendRawEmailCommand);
    expect(sendCalls).toHaveLength(1);

    const rawMessage = Buffer.from(
      sendCalls[0].args[0].input.RawMessage!.Data as Uint8Array
    ).toString();
    expect(rawMessage).toContain('X-Original-To: info@example.com');
    expect(rawMessage).toContain('noreply@example.com');

    const deleteCalls = s3Mock.commandCalls(DeleteObjectCommand);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].args[0].input.Key).toBe('emails/abc123');
  });

  test('forwards to exact route match', async () => {
    s3Mock.on(GetObjectCommand, { Key: 'emails/abc123' }).resolves({
      Body: toSdkStream(RAW_EMAIL.replace('info@example.com', 'sales@example.com')),
    });

    await handler(makeSesEvent('abc123', ['sales@example.com']));

    const sendCalls = sesMock.commandCalls(SendRawEmailCommand);
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0].args[0].input.Destinations).toContain('sales@gmail.com');
  });

  test('does not forward when no route found', async () => {
    const noRouteConfig = JSON.stringify({ domains: {} });
    const noRouteHash = createHash('sha256').update(noRouteConfig).digest('hex');
    s3Mock.on(GetObjectCommand, { Key: 'config/config.json' }).resolves({
      Body: toSdkStream(noRouteConfig),
    });
    s3Mock.on(GetObjectCommand, { Key: 'config/config.json.sha256' }).resolves({
      Body: toSdkStream(noRouteHash),
    });

    await handler(makeSesEvent('abc123', ['user@unknown.com']));

    expect(sesMock.commandCalls(SendRawEmailCommand)).toHaveLength(0);
    // Email is deleted (drop is a terminal action)
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });

  test('detects forwarding loop and deletes email', async () => {
    const loopEmail = [
      'From: "Test Sender" <sender@external.com>',
      'To: info@example.com',
      'Subject: Hello',
      'X-SES-Router-Forwarded: true',
      'Content-Type: text/plain',
      '',
      'Test body',
    ].join('\r\n');
    s3Mock.on(GetObjectCommand, { Key: 'emails/abc123' }).resolves({
      Body: toSdkStream(loopEmail),
    });

    await handler(makeSesEvent('abc123', ['info@example.com']));

    expect(sesMock.commandCalls(SendRawEmailCommand)).toHaveLength(0);
    const deleteCalls = s3Mock.commandCalls(DeleteObjectCommand);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].args[0].input.Key).toBe('emails/abc123');
  });

  test('rejects oversized emails and deletes them from S3', async () => {
    s3Mock.on(HeadObjectCommand, { Key: 'emails/abc123' }).resolves({
      ContentLength: 15 * 1024 * 1024, // 15 MB — over 10 MB limit
    });

    await handler(makeSesEvent('abc123', ['info@example.com']));

    expect(sesMock.commandCalls(SendRawEmailCommand)).toHaveLength(0);
    const deleteCalls = s3Mock.commandCalls(DeleteObjectCommand);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].args[0].input.Key).toBe('emails/abc123');
  });

  test('handles empty Records array gracefully', async () => {
    await handler({ Records: [] } as any);
    expect(sesMock.commandCalls(SendRawEmailCommand)).toHaveLength(0);
  });

  test('handles missing recipients gracefully', async () => {
    await handler({ Records: [{ ses: { mail: { messageId: 'x' }, receipt: { recipients: [] } } }] } as any);
    expect(sesMock.commandCalls(SendRawEmailCommand)).toHaveLength(0);
  });

  test('does not delete email from S3 if SES send fails', async () => {
    sesMock.on(SendRawEmailCommand).rejects(new Error('SES failure'));

    await expect(handler(makeSesEvent('abc123', ['info@example.com']))).rejects.toThrow(
      'SES failure'
    );

    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });

  test('forwards email when config hash matches', async () => {
    // Hash is set correctly in beforeEach — should forward normally
    await handler(makeSesEvent('abc123', ['info@example.com']));

    expect(sesMock.commandCalls(SendRawEmailCommand)).toHaveLength(1);
  });

  test('throws when config hash does not match', async () => {
    s3Mock.on(GetObjectCommand, { Key: 'config/config.json.sha256' }).resolves({
      Body: toSdkStream('0000000000000000000000000000000000000000000000000000000000000000'),
    });

    await expect(handler(makeSesEvent('abc123', ['info@example.com']))).rejects.toThrow(
      'Config integrity check failed'
    );

    expect(sesMock.commandCalls(SendRawEmailCommand)).toHaveLength(0);
  });

  test('throws when config hash file is missing', async () => {
    const noSuchKeyError = new Error('NoSuchKey');
    noSuchKeyError.name = 'NoSuchKey';
    s3Mock.on(GetObjectCommand, { Key: 'config/config.json.sha256' }).rejects(noSuchKeyError);

    await expect(handler(makeSesEvent('abc123', ['info@example.com']))).rejects.toThrow(
      'NoSuchKey'
    );

    expect(sesMock.commandCalls(SendRawEmailCommand)).toHaveLength(0);
  });
});

describe('handler blocking actions', () => {
  const BLOCK_CONFIG = JSON.stringify({
    domains: {
      'example.com': {
        catchAll: 'catch@gmail.com',
        routes: {
          'dennis@example.com': 'bounce',
          'spam@example.com': 'drop',
        },
      },
    },
  });
  const BLOCK_HASH = createHash('sha256').update(BLOCK_CONFIG).digest('hex');

  beforeEach(() => {
    s3Mock.on(GetObjectCommand, { Key: 'config/config.json' }).resolves({
      Body: toSdkStream(BLOCK_CONFIG),
    });
    s3Mock.on(GetObjectCommand, { Key: 'config/config.json.sha256' }).resolves({
      Body: toSdkStream(BLOCK_HASH),
    });
    sesMock.on(SendBounceCommand).resolves({ MessageId: 'bounce-123' });
  });

  test('drop action deletes without sending', async () => {
    s3Mock.on(GetObjectCommand, { Key: 'emails/abc123' }).resolves({
      Body: toSdkStream(RAW_EMAIL.replace('info@example.com', 'spam@example.com')),
    });

    await handler(makeSesEvent('abc123', ['spam@example.com']));

    expect(sesMock.commandCalls(SendRawEmailCommand)).toHaveLength(0);
    expect(sesMock.commandCalls(SendBounceCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });

  test('bounce action calls SendBounce, not SendRawEmail, then deletes', async () => {
    s3Mock.on(GetObjectCommand, { Key: 'emails/abc123' }).resolves({
      Body: toSdkStream(RAW_EMAIL.replace('info@example.com', 'dennis@example.com')),
    });

    await handler(makeSesEvent('abc123', ['dennis@example.com']));

    expect(sesMock.commandCalls(SendRawEmailCommand)).toHaveLength(0);
    const bounceCalls = sesMock.commandCalls(SendBounceCommand);
    expect(bounceCalls).toHaveLength(1);
    expect(bounceCalls[0].args[0].input.OriginalMessageId).toBe('abc123');
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });

  test('bounce with missing mailFrom falls back to drop', async () => {
    s3Mock.on(GetObjectCommand, { Key: 'emails/abc123' }).resolves({
      Body: toSdkStream(RAW_EMAIL.replace('info@example.com', 'dennis@example.com')),
    });

    await handler(makeSesEvent('abc123', ['dennis@example.com'], ''));

    expect(sesMock.commandCalls(SendBounceCommand)).toHaveLength(0);
    expect(sesMock.commandCalls(SendRawEmailCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });
});

describe('handler sender blocking', () => {
  const SPAM_EMAIL = [
    'From: "AceTooIs" <acetoois@contexttable.skin>',
    'To: rustynations@example.com',
    'Subject: Tomorrow is the last day to use AceReward points',
    'Content-Type: text/plain',
    '',
    'Test body',
  ].join('\r\n');

  const SENDER_CONFIG = JSON.stringify({
    domains: {
      'example.com': { catchAll: 'catch@gmail.com' },
    },
    blockSenders: {
      'contexttable.skin': 'spam',
      'quiet.example': 'drop',
      'gone.example': 'bounce',
    },
  });
  const SENDER_HASH = createHash('sha256').update(SENDER_CONFIG).digest('hex');

  beforeEach(() => {
    s3Mock.on(GetObjectCommand, { Key: 'config/config.json' }).resolves({
      Body: toSdkStream(SENDER_CONFIG),
    });
    s3Mock.on(GetObjectCommand, { Key: 'config/config.json.sha256' }).resolves({
      Body: toSdkStream(SENDER_HASH),
    });
    s3Mock.on(HeadObjectCommand, { Key: 'emails/spam1' }).resolves({
      ContentLength: SPAM_EMAIL.length,
    });
    s3Mock.on(GetObjectCommand, { Key: 'emails/spam1' }).resolves({
      Body: toSdkStream(SPAM_EMAIL),
    });
    sesMock.on(SendBounceCommand).resolves({ MessageId: 'bounce-123' });
  });

  test('a blocked sender beats the recipient catchAll', async () => {
    await handler(makeSesEvent('spam1', ['rustynations@example.com'], 'acetoois@contexttable.skin'));

    // catchAll would have forwarded — the sender block wins
    expect(sesMock.commandCalls(SendRawEmailCommand)).toHaveLength(0);
    expect(sesMock.commandCalls(SendBounceCommand)).toHaveLength(1);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });

  test('spam action sends a 500 / 5.6.1 content-rejected DSN with the spam flag', async () => {
    await handler(makeSesEvent('spam1', ['rustynations@example.com'], 'acetoois@contexttable.skin'));

    const bounceCalls = sesMock.commandCalls(SendBounceCommand);
    expect(bounceCalls).toHaveLength(1);

    const input = bounceCalls[0].args[0].input;
    expect(input.OriginalMessageId).toBe('spam1');
    expect(input.BounceSender).toBe('noreply@example.com');

    const dsn = input.BouncedRecipientInfoList![0].RecipientDsnFields!;
    expect(dsn.Action).toBe('failed');
    expect(dsn.Status).toBe('5.6.1');
    expect(dsn.DiagnosticCode).toBe('smtp; 500 5.6.1 Message content rejected');
    expect(dsn.ExtensionFields).toEqual(
      expect.arrayContaining([{ Name: 'X-Spam-Flag', Value: 'YES' }])
    );
  });

  test('spam action does not use the DoesNotExist bounce type', async () => {
    await handler(makeSesEvent('spam1', ['rustynations@example.com'], 'acetoois@contexttable.skin'));

    const info = sesMock.commandCalls(SendBounceCommand)[0].args[0].input.BouncedRecipientInfoList![0];
    expect(info.BounceType).toBeUndefined();
  });

  test('spam action with no envelope sender falls back to a silent drop', async () => {
    await handler(makeSesEvent('spam1', ['rustynations@example.com'], ''));

    expect(sesMock.commandCalls(SendBounceCommand)).toHaveLength(0);
    expect(sesMock.commandCalls(SendRawEmailCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });

  test('a blocked sender matched on the From header still blocks', async () => {
    // Envelope sender is a clean relay; only the From header is dirty
    await handler(makeSesEvent('spam1', ['rustynations@example.com'], 'bounces@relay.example'));

    expect(sesMock.commandCalls(SendRawEmailCommand)).toHaveLength(0);
    expect(sesMock.commandCalls(SendBounceCommand)).toHaveLength(1);
  });

  test('an unblocked sender is forwarded as before', async () => {
    await handler(makeSesEvent('abc123', ['info@example.com'], 'sender@external.com'));

    expect(sesMock.commandCalls(SendBounceCommand)).toHaveLength(0);
    expect(sesMock.commandCalls(SendRawEmailCommand)).toHaveLength(1);
  });
});

describe('handler IP blocking', () => {
  function emailFromIp(ip: string, sender = 'someone@clean.example') {
    return [
      `Received-SPF: pass (spfCheck: domain of clean.example designates ${ip} as permitted sender) client-ip=${ip};`,
      `From: "A Sender" <${sender}>`,
      'To: rustynations@example.com',
      'Subject: Thank You for Your Last Marriot Stay',
      'Content-Type: text/plain',
      '',
      'Test body',
    ].join('\r\n');
  }

  const IP_CONFIG = JSON.stringify({
    domains: { 'example.com': { catchAll: 'catch@gmail.com' } },
    blockSenders: { 'clean.example': 'drop' },
    blockIps: { '151.247.171.0/24': 'spam' },
  });
  const IP_HASH = createHash('sha256').update(IP_CONFIG).digest('hex');

  beforeEach(() => {
    s3Mock.on(GetObjectCommand, { Key: 'config/config.json' }).resolves({
      Body: toSdkStream(IP_CONFIG),
    });
    s3Mock.on(GetObjectCommand, { Key: 'config/config.json.sha256' }).resolves({
      Body: toSdkStream(IP_HASH),
    });
    sesMock.on(SendBounceCommand).resolves({ MessageId: 'bounce-123' });
  });

  function stubEmail(key: string, body: string) {
    s3Mock.on(HeadObjectCommand, { Key: `emails/${key}` }).resolves({ ContentLength: body.length });
    s3Mock.on(GetObjectCommand, { Key: `emails/${key}` }).resolves({ Body: toSdkStream(body) });
  }

  test('an IP in the blocked range bounces instead of forwarding', async () => {
    stubEmail('ip1', emailFromIp('151.247.171.147'));

    await handler(makeSesEvent('ip1', ['rustynations@example.com'], 'warmwelcomef@cabinetsought.living'));

    expect(sesMock.commandCalls(SendRawEmailCommand)).toHaveLength(0);
    const dsn = sesMock.commandCalls(SendBounceCommand)[0].args[0].input
      .BouncedRecipientInfoList![0].RecipientDsnFields!;
    expect(dsn.Status).toBe('5.6.1');
  });

  test('the IP rule wins over the sender rule', async () => {
    // clean.example is "drop" in blockSenders; the IP range is "spam".
    // A drop sends nothing, so seeing a bounce proves the IP rule ran first.
    stubEmail('ip2', emailFromIp('151.247.171.80'));

    await handler(makeSesEvent('ip2', ['rustynations@example.com'], 'someone@clean.example'));

    expect(sesMock.commandCalls(SendBounceCommand)).toHaveLength(1);
  });

  test('an IP outside the range is not blocked by it', async () => {
    stubEmail('ip3', emailFromIp('8.8.8.8', 'friend@gmail.com'));

    await handler(makeSesEvent('ip3', ['rustynations@example.com'], 'friend@gmail.com'));

    expect(sesMock.commandCalls(SendBounceCommand)).toHaveLength(0);
    expect(sesMock.commandCalls(SendRawEmailCommand)).toHaveLength(1);
  });

  test('a forged Received-SPF header cannot dodge the block', async () => {
    // The spammer appends their own header claiming a clean IP. SES wrote the
    // real one first, so the first header is the one that counts.
    const forged =
      emailFromIp('151.247.171.147') +
      '\r\nReceived-SPF: pass (spfCheck: fake) client-ip=8.8.8.8;';
    stubEmail('ip4', forged);

    await handler(makeSesEvent('ip4', ['rustynations@example.com'], 'x@cabinetsought.living'));

    expect(sesMock.commandCalls(SendBounceCommand)).toHaveLength(1);
  });

  test('mail with no SES spf header still forwards normally', async () => {
    const noSpf = [
      'From: "A Friend" <friend@gmail.com>',
      'To: rustynations@example.com',
      'Subject: Hello',
      'Content-Type: text/plain',
      '',
      'Test body',
    ].join('\r\n');
    stubEmail('ip5', noSpf);

    await handler(makeSesEvent('ip5', ['rustynations@example.com'], 'friend@gmail.com'));

    expect(sesMock.commandCalls(SendBounceCommand)).toHaveLength(0);
    expect(sesMock.commandCalls(SendRawEmailCommand)).toHaveLength(1);
  });
});
