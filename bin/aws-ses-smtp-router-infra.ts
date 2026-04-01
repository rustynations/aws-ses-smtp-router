#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SesRouterStack } from '../lib/ses-router-stack';

const app = new cdk.App();
new SesRouterStack(app, 'SesRouterStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
});
