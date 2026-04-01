# Developer Guide

## Local Setup

```bash
# Clone the repo
git clone https://github.com/rusty428/aws-ses-smtp-router.git
cd aws-ses-smtp-router

# Install dependencies
npm install

# Create routing config (required for CDK synth/deploy)
cp config.json.example config.json
```

### Requirements

- **Node.js** 22+ (Lambda runtime target)
- **npm** (package manager)
- **AWS CLI** configured with credentials for your target account
- **CDK CLI** installed globally or via npx (`npx cdk`)

## Project Structure

```
├── bin/
│   └── aws-ses-smtp-router-infra.ts    # CDK app entry point
├── lib/
│   └── ses-router-stack.ts             # Stack definition (all AWS resources)
├── lambda/forwarder/
│   ├── index.ts                        # Lambda handler
│   ├── rewriter.ts                     # Email header rewriting
│   └── router.ts                       # Routing config resolver
├── test/
│   ├── ses-router-stack.test.ts        # Infrastructure tests
│   └── lambda/
│       ├── handler.test.ts             # Handler tests (mocked AWS SDK)
│       ├── rewriter.test.ts            # Header rewriting tests
│       └── router.test.ts             # Routing logic tests
├── config.json.example                 # Routing config template
├── config.json                         # Your routing config (gitignored)
├── cdk.json                            # CDK configuration
└── package.json
```

## Testing

Tests use Jest with `aws-sdk-client-mock` for mocking AWS SDK clients.

```bash
# Run all tests
npm test

# Run with coverage
npx jest --coverage

# Run a specific test file
npx jest test/lambda/router.test.ts

# Watch mode
npx jest --watch
```

### Test Organization

- **`test/ses-router-stack.test.ts`** — CDK assertion tests verifying the correct AWS resources are created (S3 bucket lifecycle, Lambda config, SES rules, IAM policies, tags)
- **`test/lambda/handler.test.ts`** — End-to-end handler tests with mocked S3 and SES clients
- **`test/lambda/rewriter.test.ts`** — Unit tests for email header rewriting (From, Reply-To, DKIM removal, line ending preservation)
- **`test/lambda/router.test.ts`** — Unit tests for routing logic (exact match, catch-all, default fallback, case insensitivity)

## CDK Commands

```bash
# Synthesize CloudFormation template (no deploy)
npx cdk synth

# Preview what will change
npx cdk diff

# Deploy to AWS
npx cdk deploy

# Destroy all resources
npx cdk destroy
```

### First-Time Setup

If this is your first CDK project in the target account/region:

```bash
npx cdk bootstrap aws://<account-id>/us-east-1
```

## Working with the Lambda

The Lambda code lives in `lambda/forwarder/` and is bundled by CDK using esbuild. AWS SDK v3 clients are marked as external modules (not bundled) since they're available in the Lambda runtime.

To test Lambda changes locally, run the unit tests — they mock the full AWS SDK surface. There's no local invoke setup; the test suite covers the handler end-to-end.

## Adding a Domain

1. Add the domain config to `config.json`:
   ```json
   {
     "domains": {
       "newdomain.com": {
         "catchAll": "newdomain@gmail.com"
       }
     }
   }
   ```
2. Deploy: `npx cdk deploy`
3. Add DNS records from the stack outputs (DKIM CNAMEs, MX, SPF, DMARC)
4. Upload the updated config to S3:
   ```bash
   aws s3 cp config.json s3://<bucket-name>/config/config.json
   ```

## Configuration

`config.json` is the routing brain. It's deployed to S3 and read by Lambda on every invocation — no caching, no cold-start stale config.

The file is gitignored because it contains real email addresses. `config.json.example` is the template.

### Schema

```typescript
interface RouterConfig {
  defaultForwardTo?: string;       // Global fallback destination
  domains: {
    [domain: string]: {
      catchAll?: string;           // Forward unmatched addresses on this domain
      routes?: {
        [address: string]: string; // Exact address → destination mapping
      };
    };
  };
}
```

## Contributing

1. Fork the repo
2. Create a feature branch
3. Write tests for your changes
4. Ensure all tests pass (`npm test`)
5. Submit a pull request

### Code Style

- TypeScript throughout (CDK and Lambda)
- No linter configured — keep it consistent with existing code
- Tests alongside the code they test (mirror the `lambda/` structure in `test/lambda/`)
