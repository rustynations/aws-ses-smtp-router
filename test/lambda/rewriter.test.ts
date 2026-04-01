import { rewriteEmail } from '../../lambda/forwarder/rewriter';

const RAW_EMAIL = [
  'From: "Alice Sender" <alice@sender.com>',
  'To: info@example.com',
  'Subject: Test Email',
  'DKIM-Signature: v=1; a=rsa-sha256; d=sender.com; s=sel;',
  'Return-Path: <alice@sender.com>',
  'Content-Type: text/plain',
  '',
  'Hello, this is a test.',
].join('\r\n');

describe('rewriteEmail', () => {
  const result = rewriteEmail({
    rawEmail: RAW_EMAIL,
    originalRecipient: 'info@example.com',

    recipientDomain: 'example.com',
  });

  test('rewrites From to noreply with original display name', () => {
    expect(result).toMatch(/^From: "Alice Sender" <noreply@example\.com>/m);
  });

  test('sets Reply-To to original sender', () => {
    expect(result).toMatch(/^Reply-To: alice@sender\.com/m);
  });

  test('adds X-Original-To header', () => {
    expect(result).toMatch(/^X-Original-To: info@example\.com/m);
  });

  test('removes DKIM-Signature', () => {
    expect(result).not.toMatch(/^DKIM-Signature:/m);
  });

  test('removes Return-Path', () => {
    expect(result).not.toMatch(/^Return-Path:/m);
  });

  test('preserves Subject', () => {
    expect(result).toMatch(/^Subject: Test Email/m);
  });

  test('preserves body', () => {
    expect(result).toContain('Hello, this is a test.');
  });

  test('handles From without display name', () => {
    const simple = RAW_EMAIL.replace('"Alice Sender" <alice@sender.com>', 'alice@sender.com');
    const rewritten = rewriteEmail({
      rawEmail: simple,
      originalRecipient: 'info@example.com',
  
      recipientDomain: 'example.com',
    });
    expect(rewritten).toMatch(/^From: <noreply@example\.com>/m);
    expect(rewritten).toMatch(/^Reply-To: alice@sender\.com/m);
  });

  test('handles email with LF line endings', () => {
    const lfEmail = RAW_EMAIL.replace(/\r\n/g, '\n');
    const rewritten = rewriteEmail({
      rawEmail: lfEmail,
      originalRecipient: 'info@example.com',
  
      recipientDomain: 'example.com',
    });
    expect(rewritten).toMatch(/^From: "Alice Sender" <noreply@example\.com>/m);
  });
});
