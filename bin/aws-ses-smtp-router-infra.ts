#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { SesRouterStack } from '../lib/ses-router-stack';

const configPath = path.resolve(__dirname, '../config.json');

let domains: string[] = [];
let alarmEmail: string | undefined;
if (fs.existsSync(configPath)) {
  const configBody = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configBody);
  domains = Object.keys(config.domains);
  alarmEmail = config.alarmEmail;

  // Generate SHA-256 hash at synth time so it's always in sync
  const hash = crypto.createHash('sha256').update(configBody).digest('hex');
  fs.writeFileSync(`${configPath}.sha256`, hash);
}

const app = new cdk.App();
new SesRouterStack(app, 'SesRouterStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  domains,
  configPath,
  alarmEmail,
});
