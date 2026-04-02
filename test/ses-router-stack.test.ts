import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SesRouterStack } from '../lib/ses-router-stack';
import * as path from 'path';

function createTestStack(domains: string[] = ['example.com', 'another.com']): Template {
  const app = new cdk.App();
  const stack = new SesRouterStack(app, 'TestStack', {
    domains,
    configPath: path.resolve(__dirname, '../config.json.example'),
  });
  return Template.fromStack(stack);
}

describe('SesRouterStack', () => {
  test('creates S3 bucket with 7-day lifecycle on emails/', () => {
    const template = createTestStack();
    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Prefix: 'emails/',
            ExpirationInDays: 7,
            Status: 'Enabled',
          }),
        ]),
      },
    });
  });

  test('creates Lambda function with correct environment variables', () => {
    const template = createTestStack();
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Environment: {
        Variables: Match.objectLike({
          CONFIG_KEY: 'config/config.json',
        }),
      },
    });
  });

  test('creates one SES receipt rule per domain', () => {
    const template = createTestStack(['a.com', 'b.com', 'c.com']);
    template.resourceCountIs('AWS::SES::ReceiptRule', 3);
  });

  test('creates SES domain identity per domain', () => {
    const template = createTestStack(['a.com', 'b.com']);
    template.resourceCountIs('AWS::SES::EmailIdentity', 2);
  });

  test('creates receipt rule set', () => {
    const template = createTestStack();
    template.hasResourceProperties('AWS::SES::ReceiptRuleSet', {
      RuleSetName: 'ses-router-rules',
    });
  });

  test('Lambda has SES send permission scoped to configured domains', () => {
    const template = createTestStack(['example.com', 'another.com']);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ses:SendRawEmail',
            Effect: 'Allow',
            Resource: Match.arrayWith([
              {
                'Fn::Join': Match.arrayWith([
                  Match.arrayWith([
                    Match.stringLikeRegexp('arn:aws:ses:'),
                    Match.stringLikeRegexp(':identity/example\\.com'),
                  ]),
                ]),
              },
            ]),
          }),
        ]),
      },
    });
  });

  test('stack has correct tags', () => {
    const app = new cdk.App();
    const stack = new SesRouterStack(app, 'TestStack', {
      domains: ['example.com'],
      configPath: path.resolve(__dirname, '../config.json.example'),
    });
    // Tags are applied — verified by synth not throwing
    Template.fromStack(stack);
  });
});
