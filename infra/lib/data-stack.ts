/**
 * DataStack — RDS Postgres + ElastiCache Redis + Secrets Manager.
 *
 * Postgres: db.t4g.micro in dev, db.r6g.large in prod (right-size on usage).
 * Redis:    cache.t4g.micro single node in dev, 2-node replication group in prod.
 * Secrets:  one for the DB master credentials, one slot for broker keys.
 */
import { Stack, type StackProps, RemovalPolicy, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

export interface DataStackProps extends StackProps {
  envName: "dev" | "prod";
  vpc: ec2.Vpc;
}

export class DataStack extends Stack {
  public readonly dbInstance: rds.DatabaseInstance;
  public readonly dbSecret: secretsmanager.ISecret;
  public readonly redisHost: string;
  public readonly redisPort: number;
  public readonly brokerSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const isProd = props.envName === "prod";

    // ── Security groups ────────────────────────────────────────────
    const dbSg = new ec2.SecurityGroup(this, "DbSg", {
      vpc: props.vpc,
      description: "GodsView Postgres",
      allowAllOutbound: false,
    });

    const redisSg = new ec2.SecurityGroup(this, "RedisSg", {
      vpc: props.vpc,
      description: "GodsView Redis",
      allowAllOutbound: false,
    });

    // ── RDS Postgres ───────────────────────────────────────────────
    this.dbInstance = new rds.DatabaseInstance(this, "Postgres", {
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        isProd ? ec2.InstanceSize.LARGE : ec2.InstanceSize.MICRO,
      ),
      allocatedStorage: isProd ? 100 : 20,
      maxAllocatedStorage: isProd ? 1000 : 100,
      storageType: rds.StorageType.GP3,
      multiAz: isProd,
      backupRetention: Duration.days(isProd ? 14 : 1),
      deletionProtection: isProd,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      databaseName: "godsview",
      credentials: rds.Credentials.fromGeneratedSecret("godsview", {
        secretName: `godsview-${props.envName}-db`,
      }),
      securityGroups: [dbSg],
      enablePerformanceInsights: isProd,
      cloudwatchLogsExports: ["postgresql"],
      iamAuthentication: true,
    });
    this.dbSecret = this.dbInstance.secret!;

    // ── ElastiCache Redis ──────────────────────────────────────────
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, "RedisSubnets", {
      description: "GodsView Redis subnets",
      subnetIds: props.vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      }).subnetIds,
      cacheSubnetGroupName: `godsview-${props.envName}-redis`,
    });

    if (isProd) {
      const redis = new elasticache.CfnReplicationGroup(this, "RedisCluster", {
        replicationGroupDescription: "GodsView Redis (prod, replicated)",
        engine: "redis",
        engineVersion: "7.1",
        cacheNodeType: "cache.t4g.small",
        numNodeGroups: 1,
        replicasPerNodeGroup: 1,
        automaticFailoverEnabled: true,
        multiAzEnabled: true,
        cacheSubnetGroupName: redisSubnetGroup.ref,
        securityGroupIds: [redisSg.securityGroupId],
        atRestEncryptionEnabled: true,
        transitEncryptionEnabled: true,
      });
      this.redisHost = redis.attrPrimaryEndPointAddress;
      this.redisPort = 6379;
    } else {
      const redis = new elasticache.CfnCacheCluster(this, "RedisDev", {
        engine: "redis",
        engineVersion: "7.1",
        cacheNodeType: "cache.t4g.micro",
        numCacheNodes: 1,
        cacheSubnetGroupName: redisSubnetGroup.ref,
        vpcSecurityGroupIds: [redisSg.securityGroupId],
      });
      this.redisHost = redis.attrRedisEndpointAddress;
      this.redisPort = 6379;
    }

    // ── Broker secret slot (operator fills via Secrets Manager UI) ──
    this.brokerSecret = new secretsmanager.Secret(this, "BrokerKeys", {
      secretName: `godsview-${props.envName}-broker`,
      description: "Alpaca + other broker API credentials",
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          ALPACA_API_KEY: "PLACEHOLDER",
          ALPACA_SECRET_KEY: "PLACEHOLDER",
        }),
        generateStringKey: "_unused",
      },
    });

    // SG ingress: allow from compute SG (not added here — done in compute stack
    // by referencing dbSg/redisSg via cross-stack export).
    new (require("aws-cdk-lib").CfnOutput)(this, "DbSgId", {
      exportName: `godsview-${props.envName}-db-sg`,
      value: dbSg.securityGroupId,
    });
    new (require("aws-cdk-lib").CfnOutput)(this, "RedisSgId", {
      exportName: `godsview-${props.envName}-redis-sg`,
      value: redisSg.securityGroupId,
    });
  }
}
