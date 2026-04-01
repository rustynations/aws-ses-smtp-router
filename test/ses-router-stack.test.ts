import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { SesRouterStack } from '../lib/ses-router-stack';

test('Stack synthesizes', () => {
  const app = new cdk.App();
  const stack = new SesRouterStack(app, 'TestStack');
  Template.fromStack(stack);
});
