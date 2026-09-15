# Security

This document describes the security controls implemented in the SES SMTP Router, based on a comprehensive red-team assessment conducted in April 2026.

## IAM Least Privilege

The Lambda forwarder's `ses:SendRawEmail` permission is scoped to specific domain identity ARNs — only the domains configured in `config.json`. A compromised Lambda or poisoned config cannot send email from unrelated identities in the AWS account.

**Implementation:** `cdk.Arn.format()` constructs per-domain ARNs at synth time. A CDK assertion test verifies the resource is never `*`.

## Email Size Validation

Before loading an email into memory, the Lambda checks its size via `HeadObjectCommand`. Emails exceeding 10 MB are logged, deleted from S3, and skipped. This prevents out-of-memory crashes from oversized attachments (SES accepts up to 40 MB).

## Lambda Concurrency Limit

`reservedConcurrentExecutions` is set to 10, capping concurrent Lambda invocations. This prevents:
- Account-level Lambda quota exhaustion from email flooding
- Unbounded cost from volume attacks

Excess invocations queue rather than running unbounded.

## Forwarding Loop Detection

Every forwarded email includes an `X-SES-Router-Forwarded: true` header. On receipt, the Lambda checks for this header before processing. If detected, the email is deleted to prevent infinite forwarding loops caused by misconfiguration or circular routing.

## Header Injection Protection

- **Reply-To and display name** are sanitized to strip `\r`, `\n`, and null characters before being used in rewritten headers
- **Bcc headers** are stripped from the passthrough to prevent injection via crafted From values with embedded CRLF sequences

## Input Validation

The Lambda validates the SES event structure before processing:
- Empty `Records` array → logged and returned
- Missing or empty `recipients` → logged and returned

This prevents unhandled TypeError crashes from malformed events.

## S3 Bucket Security

- **Versioning enabled** — all objects (emails and config) are versioned
- **Config history** — noncurrent config versions retained for 90 days for rollback and audit
- **Email lifecycle** — emails expire after 7 days as a cost safety net
- **Private by default** — only SES (write) and the Lambda (read/delete) have access
- **Source account condition** — SES can only write from the owning account

## Config Integrity Verification

The Lambda verifies `config.json` integrity at runtime by comparing its SHA-256 hash against a co-deployed `config.json.sha256` file in S3. If the hash doesn't match or the hash file is missing, the Lambda throws and the email routes to the DLQ (triggering the DLQ depth alarm).

**Deploy flow:** `bin/aws-ses-smtp-router-infra.ts` writes the hash file at synth time, from the raw bytes it just read and validated. CDK `BucketDeployment` then uploads `config.json` and `config.json.sha256` together, keeping them in sync. There is no npm hook and no separate hash script.

**Config changes:** `cdk deploy` is the default — it validates the config and regenerates the hash before anything reaches S3. A manual S3 upload also works, but you must upload the config **and** a matching hash file; the Lambda trims the hash before comparing, so `shasum -a 256 config.json | awk '{print $1}'` is enough to produce it. Uploading the config alone rejects all mail until the hash catches up.

## Dead Letter Queue

Failed forwarding attempts (after Lambda's default 2 retries) are captured in an SQS dead letter queue with 14-day retention. Bounce and complaint notifications from SES are also routed to this queue. A CloudWatch alarm fires when messages appear.

## CloudWatch Alarms

Three alarms notify via SNS email when:
- **Lambda errors** exceed 3 in a 5-minute period
- **Lambda throttling** occurs (any throttle event)
- **DLQ depth** rises above 0 (emails failing to forward)

All alarms use `treatMissingData: NOT_BREACHING` to avoid false positives during low-traffic periods.

## SES Bounce and Complaint Handling

SNS topics capture SES bounce and complaint notifications, routed to the DLQ for visibility. This provides early warning of reputation degradation — SES suspends sending at >5% bounce rate or >0.1% complaint rate.

## Decisions and Trade-offs

| Decision | Rationale |
|----------|-----------|
| No S3 server-side encryption config | AWS enables SSE-S3 by default on all buckets since Jan 2023 |
| No S3 access logging | Single-user environment; CloudTrail covers IAM-level access |
| 10 MB email size limit | Balances large attachment support with Lambda memory safety (256 MB) |
| Concurrency limit of 10 | Sufficient for normal volume; protects account quota |
| DLQ retention of 14 days | Long enough to investigate; short enough to limit storage |
