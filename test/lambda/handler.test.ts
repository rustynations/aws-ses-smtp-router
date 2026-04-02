import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';
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

function makeSesEvent(messageId: string, recipients: string[]) {
  return {
    Records: [
      {
        ses: {
          mail: { messageId },
          receipt: { recipients },
        },
      },
    ],
  };
}

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
    s3Mock.on(GetObjectCommand, { Key: 'config/config.json' }).resolves({
      Body: toSdkStream(noRouteConfig),
    });

    await handler(makeSesEvent('abc123', ['user@unknown.com']));

    expect(sesMock.commandCalls(SendRawEmailCommand)).toHaveLength(0);
    // Email should still be deleted (no retry needed for unroutable mail)
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
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
});
