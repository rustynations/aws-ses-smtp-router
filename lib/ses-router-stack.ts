import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaBase from 'aws-cdk-lib/aws-lambda';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sesActions from 'aws-cdk-lib/aws-ses-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface SesRouterStackProps extends cdk.StackProps {
  domains: string[];
  configPath: string;
}

export class SesRouterStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SesRouterStackProps) {
    super(scope, id, props);

    const tags = cdk.Tags.of(this);
    tags.add('Project', 'aws-ses-smtp-router');
    tags.add('ManagedBy', 'cdk');

    // S3 bucket for email storage and config
    const bucket = new s3.Bucket(this, 'EmailBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
      lifecycleRules: [
        {
          prefix: 'emails/',
          expiration: cdk.Duration.days(7),
        },
        {
          prefix: 'config/',
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],
    });

    // Deploy config.json to S3
    new s3deploy.BucketDeployment(this, 'DeployConfig', {
      sources: [s3deploy.Source.asset(path.dirname(props.configPath), {
        exclude: ['*', '!config.json'],
      })],
      destinationBucket: bucket,
      destinationKeyPrefix: 'config',
    });

    // Dead letter queue for failed forwarding attempts
    const dlq = new sqs.Queue(this, 'ForwarderDLQ', {
      retentionPeriod: cdk.Duration.days(14),
    });

    // Lambda forwarder
    const forwarder = new lambda.NodejsFunction(this, 'Forwarder', {
      deadLetterQueue: dlq,
      entry: path.join(__dirname, '../lambda/forwarder/index.ts'),
      handler: 'handler',
      runtime: lambdaBase.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      reservedConcurrentExecutions: 10,
      environment: {
        BUCKET_NAME: bucket.bucketName,
        CONFIG_KEY: 'config/config.json',
      },
      bundling: {
        externalModules: ['@aws-sdk/client-s3', '@aws-sdk/client-ses'],
      },
    });

    // Lambda permissions
    bucket.grantRead(forwarder, 'emails/*');
    bucket.grantRead(forwarder, 'config/*');
    bucket.grantDelete(forwarder, 'emails/*');

    forwarder.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendRawEmail'],
        resources: props.domains.map((domain) =>
          cdk.Arn.format({
            service: 'ses',
            resource: 'identity',
            resourceName: domain,
            arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
          }, this)
        ),
      })
    );

    // Allow SES to write to S3 bucket
    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal('ses.amazonaws.com')],
        actions: ['s3:PutObject'],
        resources: [bucket.arnForObjects('emails/*')],
        conditions: {
          StringEquals: {
            'AWS:SourceAccount': this.account,
          },
        },
      })
    );

    // Allow SES to invoke Lambda
    forwarder.addPermission('SesInvoke', {
      principal: new iam.ServicePrincipal('ses.amazonaws.com'),
      sourceAccount: this.account,
    });

    // SES Receipt Rule Set
    const ruleSet = new ses.ReceiptRuleSet(this, 'RuleSet', {
      receiptRuleSetName: 'ses-router-rules',
    });

    // One receipt rule per domain
    for (const domain of props.domains) {
      // SES Domain Identity
      const identity = new ses.CfnEmailIdentity(this, `Identity-${domain}`, {
        emailIdentity: domain,
      });

      // Output DKIM CNAME values for manual DNS configuration
      new cdk.CfnOutput(this, `DkimCname1-${domain}`, {
        value: cdk.Fn.join(' → ', [identity.attrDkimDnsTokenName1, identity.attrDkimDnsTokenValue1]),
        description: `DKIM CNAME 1 for ${domain}`,
      });
      new cdk.CfnOutput(this, `DkimCname2-${domain}`, {
        value: cdk.Fn.join(' → ', [identity.attrDkimDnsTokenName2, identity.attrDkimDnsTokenValue2]),
        description: `DKIM CNAME 2 for ${domain}`,
      });
      new cdk.CfnOutput(this, `DkimCname3-${domain}`, {
        value: cdk.Fn.join(' → ', [identity.attrDkimDnsTokenName3, identity.attrDkimDnsTokenValue3]),
        description: `DKIM CNAME 3 for ${domain}`,
      });

      ruleSet.addRule(`Rule-${domain}`, {
        recipients: [domain],
        actions: [
          new sesActions.S3({
            bucket,
            objectKeyPrefix: 'emails/',
          }),
          new sesActions.Lambda({
            function: forwarder,
          }),
        ],
      });
    }

    // Outputs
    new cdk.CfnOutput(this, 'BucketName', {
      value: bucket.bucketName,
      description: 'S3 bucket for email storage',
    });

    new cdk.CfnOutput(this, 'ForwarderFunctionName', {
      value: forwarder.functionName,
      description: 'Lambda forwarder function name',
    });

    new cdk.CfnOutput(this, 'RuleSetName', {
      value: 'ses-router-rules',
      description: 'SES receipt rule set name (must be activated manually)',
    });
  }
}
