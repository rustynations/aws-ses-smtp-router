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
    } else {
      newHeaders.push(header);
    }
  }

  // Add new headers
  newHeaders.push(`Reply-To: ${originalSender}`);
  newHeaders.push(`X-Original-To: ${originalRecipient}`);

  return newHeaders.join(lineEnding) + separator + body;
}

function parseFromHeader(fromValue: string): { displayName: string; address: string } {
  // Match: "Display Name" <email@example.com> or Display Name <email@example.com>
  const bracketMatch = fromValue.match(/^"?([^"<]*?)"?\s*<([^>]+)>/);
  if (bracketMatch) {
    return { displayName: bracketMatch[1].trim(), address: bracketMatch[2].trim() };
  }

  // Match: email@example.com (bare address)
  return { displayName: '', address: fromValue.trim() };
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
