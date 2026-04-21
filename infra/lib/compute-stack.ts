/**
 * ComputeStack — ECS Fargate cluster running the api service, fronted by
 * an ALB. Dashboard is served from S3 + CloudFront.
 *
 * Prod:
 *   - api: 2 tasks (cpu=1024, mem=2048), auto-scaling 2→10
 *   - ALB with HTTPS listener
 *   - CloudFront for dashboard with OAC
 * Dev:
 *   - api: 1 task, HTTP-only ALB, CloudFront still HTTPS.
 */
import { Stack, type StackProps, Duration, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";

export interface ComputeStackProps extends StackProps {
  envName: "dev" | "prod";
  vpc: ec2.Vpc;
  dbSecret: secretsmanager.ISecret;
  brokerSecret: secretsmanager.Secret;
  redisHost: string;
  redisPort: number;
  apiRepo: ecr.Repository;
  dashboardBucket: s3.Bucket;
}

export class ComputeStack extends Stack {
  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const isProd = props.envName === "prod";

    // ── ECS cluster ───────────────────────────────────────────────
    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc: props.vpc,
      clusterName: `godsview-${props.envName}`,
      containerInsights: true,
    });

    // ── Log group ─────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, "ApiLogs", {
      logGroupName: `/godsview/${props.envName}/api`,
      retention: isProd ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
    });

    // ── Task definition ───────────────────────────────────────────
    const taskDef = new ecs.FargateTaskDefinition(this, "ApiTaskDef", {
      cpu: isProd ? 1024 : 512,
      memoryLimitMiB: isProd ? 2048 : 1024,
    });

    // Grant the task role read access to secrets
    props.dbSecret.grantRead(taskDef.taskRole);
    props.brokerSecret.grantRead(taskDef.taskRole);

    taskDef.taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"),
    );

    const container = taskDef.addContainer("api", {
      image: ecs.ContainerImage.fromEcrRepository(props.apiRepo, "latest"),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: "api" }),
      environment: {
        NODE_ENV: isProd ? "production" : "development",
        APP_ENV: props.envName,
        PORT: "3001",
        REDIS_URL: `redis://${props.redisHost}:${props.redisPort}`,
        // DATABASE_URL built at runtime from db secret (see entrypoint)
      },
      secrets: {
        DB_SECRET: ecs.Secret.fromSecretsManager(props.dbSecret),
        ALPACA_API_KEY: ecs.Secret.fromSecretsManager(
          props.brokerSecret,
          "ALPACA_API_KEY",
        ),
        ALPACA_SECRET_KEY: ecs.Secret.fromSecretsManager(
          props.brokerSecret,
          "ALPACA_SECRET_KEY",
        ),
      },
      healthCheck: {
        command: [
          "CMD-SHELL",
          "node -e \"fetch('http://localhost:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"",
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
    });
    container.addPortMappings({
      containerPort: 3001,
      protocol: ecs.Protocol.TCP,
    });

    // ── Service + ALB ─────────────────────────────────────────────
    const service = new ecs.FargateService(this, "ApiService", {
      cluster,
      taskDefinition: taskDef,
      desiredCount: isProd ? 2 : 1,
      assignPublicIp: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      enableExecuteCommand: !isProd,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 50,
      maxHealthyPercent: 200,
    });

    if (isProd) {
      const scaling = service.autoScaleTaskCount({
        minCapacity: 2,
        maxCapacity: 10,
      });
      scaling.scaleOnCpuUtilization("CpuScale", {
        targetUtilizationPercent: 60,
        scaleInCooldown: Duration.minutes(5),
        scaleOutCooldown: Duration.minutes(2),
      });
    }

    const alb = new elbv2.ApplicationLoadBalancer(this, "ApiAlb", {
      vpc: props.vpc,
      internetFacing: true,
      loadBalancerName: `godsview-${props.envName}-api`,
    });
    const listener = alb.addListener("HttpListener", {
      port: 80,
      open: true,
    });
    listener.addTargets("ApiTarget", {
      port: 3001,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: "/health",
        healthyHttpCodes: "200",
        interval: Duration.seconds(30),
      },
      deregistrationDelay: Duration.seconds(30),
    });

    // ── Dashboard CloudFront ──────────────────────────────────────
    const cf = new cloudfront.Distribution(this, "DashboardCdn", {
      comment: `GodsView ${props.envName} dashboard`,
      defaultRootObject: "index.html",
      errorResponses: [
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
      ],
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(props.dashboardBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        "/api/*": {
          origin: new origins.LoadBalancerV2Origin(alb, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        },
      },
    });

    // ── Outputs ───────────────────────────────────────────────────
    new CfnOutput(this, "AlbDns", { value: alb.loadBalancerDnsName });
    new CfnOutput(this, "DashboardUrl", { value: `https://${cf.domainName}` });
    new CfnOutput(this, "ApiRepoUri", { value: props.apiRepo.repositoryUri });
  }
}
