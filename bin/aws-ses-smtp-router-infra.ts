#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import * as path from 'path';
import { SesRouterStack } from '../lib/ses-router-stack';

const configPath = path.resolve(__dirname, '../config.json');

let domains: string[] = [];
if (fs.existsSync(configPath)) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  domains = Object.keys(config.domains);
}

const app = new cdk.App();
new SesRouterStack(app, 'SesRouterStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  domains,
  configPath,
});
