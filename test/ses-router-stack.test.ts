import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as path from 'path';
import { SesRouterStack } from '../lib/ses-router-stack';

test('Stack synthesizes', () => {
  const app = new cdk.App();
  const stack = new SesRouterStack(app, 'TestStack', {
    domains: ['example.com'],
    configPath: path.resolve(__dirname, '../../config.json'),
  });
  Template.fromStack(stack);
});
