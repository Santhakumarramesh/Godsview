/**
 * NetworkStack — VPC with public/private subnets across 2 AZs.
 *
 * Intentionally kept small: one VPC, two AZs. Dev uses 1 NAT gateway
 * for cost; prod uses 2 NATs (one per AZ) for HA.
 */
import { Stack, type StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";

export interface NetworkStackProps extends StackProps {
  envName: "dev" | "prod";
}

export class NetworkStack extends Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, "Vpc", {
      vpcName: `godsview-${props.envName}`,
      ipAddresses: ec2.IpAddresses.cidr("10.20.0.0/16"),
      maxAzs: 2,
      natGateways: props.envName === "prod" ? 2 : 1,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "private-egress",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: "isolated",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // Flow logs — required for prod, cheap for dev.
    this.vpc.addFlowLog("FlowLog", {
      trafficType: ec2.FlowLogTrafficType.REJECT,
    });
  }
}
