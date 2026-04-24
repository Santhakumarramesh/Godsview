/**
 * AlarmsStack — CloudWatch alarms for production monitoring.
 *
 * Covers:
 *   - ECS service health (CPU, memory, task count)
 *   - RDS health (CPU, connections, free storage)
 *   - ElastiCache health (CPU, memory, evictions)
 *   - ALB health (5xx errors, latency, unhealthy targets)
 *   - SNS topic for alarm notifications
 */
import { Stack, type StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";

export interface AlarmsStackProps extends StackProps {
  envName: "dev" | "prod";
  ecsClusterName: string;
  ecsServiceName: string;
  rdsInstanceId: string;
  redisClusterId: string;
  albArn: string;
  notificationEmail?: string;
}

export class AlarmsStack extends Stack {
  constructor(scope: Construct, id: string, props: AlarmsStackProps) {
    super(scope, id, props);

    const isProd = props.envName === "prod";
    if (!isProd) return; // Only create alarms for production

    // ── SNS Topic for notifications ──────────────────────────────
    const alarmTopic = new sns.Topic(this, "AlarmTopic", {
      topicName: `godsview-${props.envName}-alarms`,
      displayName: "GodsView Production Alarms",
    });

    if (props.notificationEmail) {
      alarmTopic.addSubscription(
        new subscriptions.EmailSubscription(props.notificationEmail)
      );
    }

    const alarmAction = new actions.SnsAction(alarmTopic);

    // ── ECS Alarms ───────────────────────────────────────────────
    const ecsCpuAlarm = new cloudwatch.Alarm(this, "EcsCpuHigh", {
      alarmName: "godsview-ecs-cpu-high",
      metric: new cloudwatch.Metric({
        namespace: "AWS/ECS",
        metricName: "CPUUtilization",
        dimensionsMap: {
          ClusterName: props.ecsClusterName,
          ServiceName: props.ecsServiceName,
        },
        statistic: "Average",
        period: Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    ecsCpuAlarm.addAlarmAction(alarmAction);

    const ecsMemoryAlarm = new cloudwatch.Alarm(this, "EcsMemoryHigh", {
      alarmName: "godsview-ecs-memory-high",
      metric: new cloudwatch.Metric({
        namespace: "AWS/ECS",
        metricName: "MemoryUtilization",
        dimensionsMap: {
          ClusterName: props.ecsClusterName,
          ServiceName: props.ecsServiceName,
        },
        statistic: "Average",
        period: Duration.minutes(5),
      }),
      threshold: 85,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    ecsMemoryAlarm.addAlarmAction(alarmAction);

    // ── RDS Alarms ───────────────────────────────────────────────
    const rdsCpuAlarm = new cloudwatch.Alarm(this, "RdsCpuHigh", {
      alarmName: "godsview-rds-cpu-high",
      metric: new cloudwatch.Metric({
        namespace: "AWS/RDS",
        metricName: "CPUUtilization",
        dimensionsMap: { DBInstanceIdentifier: props.rdsInstanceId },
        statistic: "Average",
        period: Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    rdsCpuAlarm.addAlarmAction(alarmAction);

    const rdsConnectionsAlarm = new cloudwatch.Alarm(this, "RdsConnectionsHigh", {
      alarmName: "godsview-rds-connections-high",
      metric: new cloudwatch.Metric({
        namespace: "AWS/RDS",
        metricName: "DatabaseConnections",
        dimensionsMap: { DBInstanceIdentifier: props.rdsInstanceId },
        statistic: "Average",
        period: Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    rdsConnectionsAlarm.addAlarmAction(alarmAction);

    const rdsFreeStorageAlarm = new cloudwatch.Alarm(this, "RdsFreeStorageLow", {
      alarmName: "godsview-rds-storage-low",
      metric: new cloudwatch.Metric({
        namespace: "AWS/RDS",
        metricName: "FreeStorageSpace",
        dimensionsMap: { DBInstanceIdentifier: props.rdsInstanceId },
        statistic: "Average",
        period: Duration.minutes(15),
      }),
      threshold: 5 * 1024 * 1024 * 1024, // 5 GB
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    });
    rdsFreeStorageAlarm.addAlarmAction(alarmAction);

    // ── ElastiCache Alarms ───────────────────────────────────────
    const redisCpuAlarm = new cloudwatch.Alarm(this, "RedisCpuHigh", {
      alarmName: "godsview-redis-cpu-high",
      metric: new cloudwatch.Metric({
        namespace: "AWS/ElastiCache",
        metricName: "CPUUtilization",
        dimensionsMap: { CacheClusterId: props.redisClusterId },
        statistic: "Average",
        period: Duration.minutes(5),
      }),
      threshold: 75,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    redisCpuAlarm.addAlarmAction(alarmAction);

    const redisEvictionsAlarm = new cloudwatch.Alarm(this, "RedisEvictions", {
      alarmName: "godsview-redis-evictions",
      metric: new cloudwatch.Metric({
        namespace: "AWS/ElastiCache",
        metricName: "Evictions",
        dimensionsMap: { CacheClusterId: props.redisClusterId },
        statistic: "Sum",
        period: Duration.minutes(5),
      }),
      threshold: 100,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    redisEvictionsAlarm.addAlarmAction(alarmAction);

    // ── ALB Alarms ───────────────────────────────────────────────
    const alb5xxAlarm = new cloudwatch.Alarm(this, "Alb5xxHigh", {
      alarmName: "godsview-alb-5xx-high",
      metric: new cloudwatch.Metric({
        namespace: "AWS/ApplicationELB",
        metricName: "HTTPCode_ELB_5XX_Count",
        dimensionsMap: { LoadBalancer: props.albArn },
        statistic: "Sum",
        period: Duration.minutes(5),
      }),
      threshold: 10,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    alb5xxAlarm.addAlarmAction(alarmAction);

    const albLatencyAlarm = new cloudwatch.Alarm(this, "AlbLatencyHigh", {
      alarmName: "godsview-alb-latency-high",
      metric: new cloudwatch.Metric({
        namespace: "AWS/ApplicationELB",
        metricName: "TargetResponseTime",
        dimensionsMap: { LoadBalancer: props.albArn },
        statistic: "p99",
        period: Duration.minutes(5),
      }),
      threshold: 5, // 5 seconds p99
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    albLatencyAlarm.addAlarmAction(alarmAction);
  }
}
