# Architecture

## Overview

AWS SES SMTP Router is a serverless email forwarding system. It receives email on any number of domains, resolves a destination from a JSON config, rewrites headers, and forwards via SES. The entire system is a single CDK stack with no external dependencies beyond AWS.

## System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                        AWS Account                       │
│                                                          │
│  Inbound Email                                           │
│       │                                                  │
│       ▼                                                  │
│  ┌─────────┐    ┌──────────┐    ┌────────────────────┐  │
│  │   SES   │───▶│    S3    │───▶│      Lambda        │  │
│  │ Receipt │    │  Bucket  │    │    (Forwarder)     │  │
│  │  Rules  │    │          │    │                    │  │
│  └─────────┘    │ emails/  │    │ 1. Fetch email     │  │
│                 │ config/  │    │ 2. Fetch config    │  │
│                 └──────────┘    │ 3. Resolve route   │  │
│                                 │ 4. Rewrite headers │  │
│                                 │ 5. Send via SES    │  │
│                                 │ 6. Delete from S3  │  │
│                                 └────────┬───────────┘  │
│                                          │               │
│                                          ▼               │
│                                    ┌──────────┐          │
│                                    │   SES    │          │
│                                    │ SendRaw  │──────────┼──▶ Gmail / External Mailbox
│                                    │  Email   │          │
│                                    └──────────┘          │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## AWS Resources

The CDK stack creates:

| Resource | Purpose |
|----------|---------|
| **S3 Bucket** | Stores incoming raw emails (`emails/`) and routing config (`config/`) |
| **Lambda Function** | Processes, rewrites, and forwards email |
| **SES Receipt Rule Set** | Container for domain receipt rules |
| **SES Receipt Rule** (per domain) | Catches all email for a domain, triggers S3 store + Lambda |
| **SES Email Identity** (per domain) | Registers domain with SES, generates DKIM tokens |
| **S3 Bucket Policy** | Allows SES to write to the bucket |
| **Lambda Permission** | Allows SES to invoke the function |
| **IAM Policy** | Grants Lambda read/delete on S3 and `ses:SendRawEmail` |

## Email Processing Flow

### 1. Receipt

SES receives an email addressed to any configured domain. The receipt rule matches on the domain (catch-all — no specific addresses are configured at the SES level). Two actions fire in sequence:

1. **S3 Action** — stores the raw email at `emails/{messageId}`
2. **Lambda Action** — invokes the forwarder with an SES event containing the `messageId` and `recipients` array

### 2. Routing

The Lambda fetches `config/config.json` from S3 and resolves the destination using a three-tier priority:

```
Exact address match  →  Domain catch-all  →  Global default  →  Discard
```

Address matching is case-insensitive. If no route is found at any tier, the email is logged and silently discarded.

### 3. Header Rewriting

Before forwarding, the Lambda rewrites headers to ensure clean delivery and maintain the reply chain:

```
Original:
  From: "Alice" <alice@sender.com>
  Return-Path: <alice@sender.com>
  DKIM-Signature: ...

Rewritten:
  From: "Alice" <noreply@yourdomain.com>
  Reply-To: alice@sender.com
  X-Original-To: info@yourdomain.com
  (Return-Path removed — SES sets its own)
  (DKIM-Signature removed — invalid after rewrite)
```

Key decisions:
- **From** is rewritten to `noreply@<receiving-domain>` to avoid SPF/DKIM failures on the forwarding hop
- **Reply-To** is set to the original sender so replies go to the right place
- **X-Original-To** preserves which address the email was sent to, useful for Gmail filters
- **Body is untouched** — only headers are modified
- **Line endings are preserved** — handles both CRLF and LF emails
- **Folded headers are unfolded** before processing to handle RFC 822 multi-line headers

### 4. Forwarding

The rewritten email is sent via `SES SendRawEmail` to the resolved destination. The original email is deleted from S3 only after a successful send.

If SES fails to send, the Lambda throws an exception (preserving the email in S3) and the invocation is retried by the SES-Lambda integration.

## Configuration Architecture

```
config.json (S3)
├── defaultForwardTo: string        ← Global fallback
└── domains
    ├── example.com
    │   ├── catchAll: string        ← Domain-level fallback
    │   └── routes
    │       ├── sales@example.com   ← Exact match
    │       └── support@example.com ← Exact match
    └── another.com
        └── catchAll: string
```

Config lives in S3, not in the Lambda code or CDK parameters. This means:
- **Routing changes** (where mail goes) require a `cdk deploy` to keep the config and its integrity hash in sync. It's possible to upload both files to S3 manually, but a full deploy is the recommended path.
- **Domain changes** (adding/removing domains) always require a `cdk deploy` to create/remove SES identities and receipt rules

The Lambda reads config fresh on every invocation. No caching, no stale state.

## S3 Bucket Layout

```
s3://<bucket>/
├── config/
│   └── config.json        ← Routing configuration
└── emails/
    └── {messageId}        ← Raw emails (auto-expire after 7 days)
```

The 7-day lifecycle rule on `emails/` is a safety net. Emails are normally deleted immediately after successful forwarding. The lifecycle catches anything that slips through (Lambda failures, edge cases).

## Lambda Design

- **Runtime:** Node.js 22.x
- **Memory:** 256 MB
- **Timeout:** 30 seconds
- **Bundling:** esbuild via CDK's `NodejsFunction`, AWS SDK v3 marked as external

The Lambda is split into three modules:

| Module | Responsibility |
|--------|---------------|
| `index.ts` | Handler — orchestrates the fetch/route/rewrite/send/delete pipeline |
| `router.ts` | Resolves destination from config + recipient address |
| `rewriter.ts` | Rewrites email headers for clean forwarding |

This separation keeps each module testable in isolation. The handler tests mock the AWS SDK; the router and rewriter tests are pure logic with no mocks needed.

## Security

- S3 bucket policy restricts SES writes to the owning AWS account
- Lambda permission restricts SES invocation to the owning account
- Lambda IAM policy is scoped to specific S3 prefixes (`emails/*`, `config/*`) and `ses:SendRawEmail`
- `config.json` contains email addresses but no secrets — it's not in git
- No VPC required — all communication is over AWS service endpoints

## Cost

For typical low-to-moderate email volume (hundreds to low thousands per month):

- **SES receiving:** Free (first 1,000 emails/month)
- **SES sending:** $0.10 per 1,000 emails
- **Lambda:** Free tier covers most usage (1M requests/month)
- **S3:** Negligible (emails are deleted after forwarding)

Total cost for most deployments: effectively zero.
