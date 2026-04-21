#!/usr/bin/env node
/**
 * GodsView AWS CDK entry point.
 *
 * Supports two environments controlled by `-c env=dev|prod`:
 *   pnpm --filter @workspace/infra deploy:dev
 *   pnpm --filter @workspace/infra deploy:prod
 *
 * Stacks are split for blast-radius control:
 *   NetworkStack  — VPC, subnets, SGs
 *   DataStack     — RDS Postgres, ElastiCache Redis, Secrets Manager
 *   StorageStack  — S3 buckets (model artifacts, logs), ECR repos
 *   ComputeStack  — ECS Fargate (api), ALB, CloudFront for dashboard
 */
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { NetworkStack } from "../lib/network-stack";
import { DataStack } from "../lib/data-stack";
import { StorageStack } from "../lib/storage-stack";
import { ComputeStack } from "../lib/compute-stack";

const app = new cdk.App();

const envName = (app.node.tryGetContext("env") ?? "dev") as "dev" | "prod";
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION ?? "us-east-1";

if (envName !== "dev" && envName !== "prod") {
  throw new Error(`Invalid -c env=${envName}. Expected "dev" or "prod".`);
}

const awsEnv: cdk.Environment = { account, region };
const baseName = `godsview-${envName}`;

const network = new NetworkStack(app, `${baseName}-network`, {
  env: awsEnv,
  envName,
});

const storage = new StorageStack(app, `${baseName}-storage`, {
  env: awsEnv,
  envName,
});

const data = new DataStack(app, `${baseName}-data`, {
  env: awsEnv,
  envName,
  vpc: network.vpc,
});

new ComputeStack(app, `${baseName}-compute`, {
  env: awsEnv,
  envName,
  vpc: network.vpc,
  dbSecret: data.dbSecret,
  redisHost: data.redisHost,
  redisPort: data.redisPort,
  apiRepo: storage.apiRepo,
  dashboardBucket: storage.dashboardBucket,
  brokerSecret: data.brokerSecret,
});

// Tag everything for cost allocation & ownership.
cdk.Tags.of(app).add("Project", "GodsView");
cdk.Tags.of(app).add("Environment", envName);
cdk.Tags.of(app).add("ManagedBy", "CDK");

app.synth();
