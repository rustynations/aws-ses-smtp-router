export interface RewriteOptions {
  rawEmail: string;
  originalRecipient: string;
  recipientDomain: string;
}

export function rewriteEmail(options: RewriteOptions): string {
  const { rawEmail, originalRecipient, recipientDomain } = options;

  // Split headers and body at first blank line
  const separator = rawEmail.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n';
  const lineEnding = rawEmail.includes('\r\n') ? '\r\n' : '\n';
  const separatorIndex = rawEmail.indexOf(separator);
  const headerSection = rawEmail.substring(0, separatorIndex);
  const body = rawEmail.substring(separatorIndex + separator.length);

  // Extract original sender from From header
  const fromMatch = headerSection.match(/^From:\s*(.+)$/mi);
  const fromValue = fromMatch ? fromMatch[1].trim() : '';
  const { displayName, address: originalSender } = parseFromHeader(fromValue);

  // Build new From header
  const newFrom = displayName
    ? `From: "${displayName}" <noreply@${recipientDomain}>`
    : `From: <noreply@${recipientDomain}>`;

  // Process headers line by line
  const headers = unfoldHeaders(headerSection, lineEnding);
  const newHeaders: string[] = [];

  for (const header of headers) {
    const headerLower = header.toLowerCase();

    // Remove headers we're replacing or stripping
    if (headerLower.startsWith('from:')) {
      newHeaders.push(newFrom);
    } else if (headerLower.startsWith('return-path:')) {
      continue; // Remove — SES sets its own
    } else if (headerLower.startsWith('dkim-signature:')) {
      continue; // Remove — invalid after rewrite
    } else if (headerLower.startsWith('reply-to:')) {
      continue; // We'll add our own below
    } else if (headerLower.startsWith('bcc:')) {
      continue; // Strip — forwarded emails should not carry Bcc
    } else {
      newHeaders.push(header);
    }
  }

  // Add new headers (sanitize to prevent header injection)
  const safeSender = originalSender.replace(/[\r\n\0]/g, '');
  newHeaders.push(`Reply-To: ${safeSender}`);
  newHeaders.push(`X-Original-To: ${originalRecipient}`);
  newHeaders.push('X-SES-Router-Forwarded: true');

  return newHeaders.join(lineEnding) + separator + body;
}

/**
 * Read the address out of the From header, before any rewriting. Used to check
 * a sender against the block list — the envelope sender alone is not enough,
 * because spam routinely differs between the two.
 */
export function extractSenderAddress(rawEmail: string): string {
  const separator = rawEmail.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n';
  const separatorIndex = rawEmail.indexOf(separator);
  const headerSection =
    separatorIndex === -1 ? rawEmail : rawEmail.substring(0, separatorIndex);

  const fromMatch = headerSection.match(/^From:\s*(.+)$/mi);
  if (!fromMatch) return '';

  return parseFromHeader(fromMatch[1].trim()).address;
}

/**
 * Read the sending IP that SES observed, out of the `Received-SPF` header SES
 * writes before storing the message.
 *
 * A sender can paste their own `Received-SPF` into the mail they submit, so this
 * takes only the FIRST such header, and only one bearing SES's own `spfCheck`
 * marker. SES prepends its header, so the first match is always SES's own.
 * Returns '' when there is no SES header to read.
 */
export function extractSenderIp(rawEmail: string): string {
  const separator = rawEmail.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n';
  const lineEnding = rawEmail.includes('\r\n') ? '\r\n' : '\n';
  const separatorIndex = rawEmail.indexOf(separator);
  const headerSection =
    separatorIndex === -1 ? rawEmail : rawEmail.substring(0, separatorIndex);

  for (const header of unfoldHeaders(headerSection, lineEnding)) {
    if (!/^Received-SPF:/i.test(header)) continue;
    if (!header.includes('spfCheck')) continue; // not SES's own check
    const ipMatch = header.match(/client-ip=([0-9a-f.:]+)/i);
    return ipMatch ? ipMatch[1] : '';
  }

  return '';
}

function parseFromHeader(fromValue: string): { displayName: string; address: string } {
  // Match: "Display Name" <email@example.com> or Display Name <email@example.com>
  const bracketMatch = fromValue.match(/^"?([^"<]*?)"?\s*<([^>]+)>/);
  if (bracketMatch) {
    return {
      displayName: bracketMatch[1].trim().replace(/[\r\n\0"]/g, ''),
      address: bracketMatch[2].trim().replace(/[\r\n\0]/g, ''),
    };
  }

  // Match: email@example.com (bare address)
  return { displayName: '', address: fromValue.trim().replace(/[\r\n\0]/g, '') };
}

function unfoldHeaders(headerSection: string, lineEnding: string): string[] {
  const lines = headerSection.split(lineEnding);
  const headers: string[] = [];

  for (const line of lines) {
    // Continuation lines start with whitespace (folded headers)
    if (line.match(/^[ \t]/) && headers.length > 0) {
      headers[headers.length - 1] += lineEnding + line;
    } else {
      headers.push(line);
    }
  }

  return headers;
}
