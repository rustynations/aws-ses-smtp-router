# AWS SES SMTP Router

Serverless email routing using AWS SES and Lambda. Receives mail for multiple domains via catch-all rules and forwards to configurable external mailboxes (e.g., Gmail).

Built with CDK. No servers to manage, no mail platform to maintain — just a Lambda that reads a config file and forwards your email.

## Why

Managed email services like AWS WorkMail are expensive, opaque, and one deprecation notice away from a forced migration. Most domains don't need a mailbox — they need a pipe. Mail comes in, mail goes somewhere useful. This project does exactly that for pennies per month.

## How It Works

```
Inbound email → SES Receipt Rule → S3 → Lambda → SES Send → Gmail (or any mailbox)
```

1. SES receives email for your domains (catch-all)
2. Raw email is stored in S3
3. Lambda fetches the email + routing config
4. Headers are rewritten (From, Reply-To, X-Original-To)
5. Email is forwarded to the configured destination
6. Original is deleted from S3

## Features

- **Multi-domain** — route any number of domains from a single stack
- **Catch-all + per-address routing** — flexible three-tier routing (exact match → domain catch-all → global default)
- **Header rewriting** — preserves Reply-To chain, adds X-Original-To for downstream filtering
- **Config-driven** — change routing by updating a JSON file in S3, no redeploy needed
- **Auto-cleanup** — S3 lifecycle expires stored emails after 7 days

## Quick Start

### Prerequisites

- AWS account with [SES configured](https://docs.aws.amazon.com/ses/latest/dg/setting-up.html) in `us-east-1`
- Node.js 22+
- AWS CLI configured with credentials
- CDK bootstrapped in your account (`npx cdk bootstrap aws://<account-id>/us-east-1`)

### Deploy

```bash
# Install dependencies
npm install

# Create your routing config
cp config.json.example config.json
# Edit config.json with your domains and forwarding addresses

# Deploy
npx cdk deploy
```

### Post-Deploy

1. **Add DNS records** — the stack outputs DKIM CNAME records for each domain. Add these plus MX and SPF/DMARC records to your DNS provider.
2. **Activate the rule set** — SES receipt rule sets must be manually activated:
   ```bash
   aws ses set-active-receipt-rule-set --rule-set-name ses-router-rules
   ```
3. **Wait for DKIM verification** — can take up to 72 hours, usually much faster.
4. **Test** — send an email to `anything@yourdomain.com` and confirm it arrives.

## Configuration

Routing is defined in `config.json`:

```json
{
  "defaultForwardTo": "fallback@gmail.com",
  "domains": {
    "example.com": {
      "catchAll": "example@gmail.com",
      "routes": {
        "sales@example.com": "sales-team@gmail.com",
        "support@example.com": "support-team@gmail.com"
      }
    },
    "another-domain.com": {
      "catchAll": "another@gmail.com"
    }
  }
}
```

### Routing Priority

1. **Exact address match** — `sales@example.com` → `sales-team@gmail.com`
2. **Domain catch-all** — `anything@example.com` → `example@gmail.com`
3. **Global default** — `user@unknown-domain.com` → `fallback@gmail.com`
4. **No match** — email is silently discarded (logged)

### Updating Routes Without Redeploying

To change where mail forwards (without adding/removing domains):

```bash
aws s3 cp config.json s3://<bucket-name>/config/config.json
```

Adding a new domain requires a `cdk deploy` to create the SES identity and receipt rule.

## Header Rewriting

Forwarded emails have their headers rewritten for clean delivery:

| Header | Value |
|--------|-------|
| `From` | `"Original Sender Name" <noreply@yourdomain.com>` |
| `Reply-To` | Original sender's address |
| `X-Original-To` | The address that received the email |
| `Return-Path` | Removed (SES sets its own) |
| `DKIM-Signature` | Removed (invalid after rewrite) |

The `X-Original-To` header is useful for setting up Gmail filters per recipient address.

## Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run watch` | Watch and compile on changes |
| `npm run test` | Run tests |
| `npx cdk deploy` | Deploy stack |
| `npx cdk diff` | Preview changes |
| `npx cdk synth` | Emit CloudFormation template |
| `npx cdk destroy` | Tear down stack |

## Documentation

- [Architecture](ARCHITECTURE.md) — system design, data flow, and infrastructure details
- [Developer Guide](DEVELOPER.md) — local setup, testing, and contributing

## License

[MIT](LICENSE)
