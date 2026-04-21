/**
 * StorageStack — S3 buckets (dashboard static, model artifacts, logs)
 * and ECR repositories (api image).
 */
import { Stack, type StackProps, RemovalPolicy, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ecr from "aws-cdk-lib/aws-ecr";

export interface StorageStackProps extends StackProps {
  envName: "dev" | "prod";
}

export class StorageStack extends Stack {
  public readonly dashboardBucket: s3.Bucket;
  public readonly modelBucket: s3.Bucket;
  public readonly logBucket: s3.Bucket;
  public readonly apiRepo: ecr.Repository;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const isProd = props.envName === "prod";
    const removalPolicy = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // ── Dashboard static bucket (served via CloudFront in ComputeStack) ──
    this.dashboardBucket = new s3.Bucket(this, "Dashboard", {
      bucketName: `godsview-${props.envName}-dashboard-${this.account}`,
      removalPolicy,
      autoDeleteObjects: !isProd,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: isProd,
    });

    // ── Model artifacts (Python backtest / ML outputs) ──
    this.modelBucket = new s3.Bucket(this, "Models", {
      bucketName: `godsview-${props.envName}-models-${this.account}`,
      removalPolicy,
      autoDeleteObjects: !isProd,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: isProd,
      lifecycleRules: [
        {
          id: "expire-old-experiments",
          prefix: "experiments/",
          expiration: Duration.days(isProd ? 365 : 30),
        },
      ],
    });

    // ── Log bucket (CloudFront + ALB access logs) ──
    this.logBucket = new s3.Bucket(this, "Logs", {
      bucketName: `godsview-${props.envName}-logs-${this.account}`,
      removalPolicy,
      autoDeleteObjects: !isProd,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: "expire-logs",
          expiration: Duration.days(isProd ? 90 : 14),
        },
      ],
      // ALB/CloudFront logs require ACLs enabled
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
    });

    // ── ECR repo for api-server image ──
    this.apiRepo = new ecr.Repository(this, "ApiRepo", {
      repositoryName: `godsview-${props.envName}-api`,
      removalPolicy,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      imageScanOnPush: true,
      lifecycleRules: [
        {
          description: "Keep last 20 images",
          maxImageCount: 20,
        },
      ],
    });
  }
}
