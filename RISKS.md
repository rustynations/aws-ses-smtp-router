# Known Risks

This document covers inherent risks of running a serverless email forwarding system. These aren't bugs or missing features — they're trade-offs and limitations to be aware of before deploying.

## No Spam Filtering

Everything SES accepts gets forwarded. SES performs basic virus and spam scanning at the receipt level, but sophisticated spam will pass through. Your destination mailbox (e.g., Gmail) becomes your spam filter. There is no built-in content filtering, blocklist, or sender reputation check in this stack.

## SES Reputation

When the router forwards an email, your domain is the sender. If someone sends spam *to* your domain, you forward spam *from* your domain. Amazon SES monitors bounce and complaint rates and will suspend your sending ability if:

- **Bounce rate** exceeds 5%
- **Complaint rate** exceeds 0.1%

You don't control what people send to your domains. High-traffic domains with public-facing addresses (e.g., `info@`, `contact@`) are more exposed. The stack captures bounces and complaints via SNS → DLQ, but acting on them is manual.

## Single-Recipient Processing

The Lambda processes only the first recipient in each SES event. If an email is addressed to multiple recipients on your domains, only the first one triggers forwarding. This is a limitation of how SES receipt rules invoke Lambda — each rule fires independently per domain, but within a single invocation, only the first recipient is handled.

## 10 MB Email Size Limit

Emails exceeding 10 MB are logged, deleted from S3, and silently discarded. The sender receives no bounce notification — SES already accepted the email (SES allows up to 40 MB), so from the sender's perspective, delivery succeeded. Large attachments are the most common trigger.

## Lambda Concurrency Limit

The stack limits Lambda to 10 concurrent executions. Under normal volume this is more than sufficient, but during traffic spikes (mailing list explosions, spam floods), excess invocations queue behind the concurrency limit. Sustained high volume means delivery delays. The throttle alarm will fire, but queued emails are not lost — they retry automatically.

## Region Lock

SES email receiving is only available in `us-east-1`, `eu-west-1`, and `us-west-2`. This stack hardcodes `us-east-1`. Changing the region requires editing the CDK entry point and redeploying. All SES identities, receipt rules, and DNS records are region-specific.

## Header Rewriting Breaks Original DKIM

The router rewrites the `From` header and strips the original DKIM signature (which would be invalid after modification). The forwarded email is re-signed by SES with your domain's DKIM keys. Some mail clients may display a "via" notice or show a mismatch warning, depending on how strictly they verify sender identity.

## DNS Is Your Responsibility

The stack creates SES domain identities and outputs DKIM CNAME values, but it does not manage DNS. You must manually add MX, DKIM, SPF, and DMARC records to your DNS provider. Misconfigured DNS means:

- **Missing MX record** — email never reaches SES
- **Missing DKIM CNAMEs** — SES identity stays unverified, outbound mail fails DKIM checks
- **Missing SPF** — forwarded email may be flagged as spam by recipients
- **Missing DMARC** — no policy enforcement, reduced deliverability

There is no validation or health check in the stack for DNS configuration.

## SES Sandbox on New Accounts

New AWS accounts start in the SES sandbox, which restricts sending to verified email addresses only. Forwarding will silently fail for any destination address that isn't verified in SES. You must request production access through the AWS console or CLI before the router can forward to arbitrary addresses. This is easy to miss because inbound receiving works in sandbox mode — only outbound sending is restricted.
