/**
 * EXAMPLE (synth-tested, never deployed). DNS and email identity for one stage.
 *
 * Deployed first and on its own (docs/DEPLOY.md), because nothing else can finish
 * until the domain points here:
 *   prod: nutritiondictionary.com. Copy the NameServers output into Porkbun.
 *   dev:  dev.nutritiondictionary.com. Copy its NameServers output into cdk.json
 *         ("devNameServers") and redeploy the prod DNS stack, which adds the delegation.
 *
 * SES: the domain identity publishes its own DKIM records (Easy DKIM, 3 CNAMEs) and a
 * custom MAIL FROM domain (MX + SPF) into this zone, so the owner adds no records by
 * hand. Verification finishes by itself once DNS resolves. Production access (leaving
 * the SES sandbox) is a separate request in the console.
 */
import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ses from 'aws-cdk-lib/aws-ses';

export interface DnsStackProps extends StackProps {
  stage: 'dev' | 'prod';
  /** The zone this account owns, e.g. "nutritiondictionary.com" or "dev.nutritiondictionary.com". */
  zoneName: string;
  /** Subdomains delegated to another account: label -> its zone's nameservers. Empty lists are skipped. */
  delegations?: Record<string, string[]>;
}

export class DnsStack extends Stack {
  readonly zone: route53.IPublicHostedZone;
  /** The SES identity name (the domain), for the sender's IAM grant. */
  readonly emailIdentityName: string;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);

    const zone = new route53.PublicHostedZone(this, 'Zone', {
      zoneName: props.zoneName,
      comment: `NutritionDictionary ${props.stage}. Managed by CDK (NutritionDictionaryDns-${props.stage}).`,
    });
    // Deleting the zone would break the registrar's nameserver records, and a new zone
    // gets new nameservers. Keep it even if the stack is deleted.
    zone.applyRemovalPolicy(RemovalPolicy.RETAIN);
    this.zone = zone;

    for (const [label, nameServers] of Object.entries(props.delegations ?? {})) {
      if (!nameServers.length) continue;
      new route53.NsRecord(this, `Delegate-${label}`, {
        zone,
        recordName: label,
        values: nameServers,
        ttl: Duration.days(2),
      });
    }

    // ---------------------------------------------------------------- SES
    new ses.EmailIdentity(this, 'EmailIdentity', {
      identity: ses.Identity.publicHostedZone(zone),
      dkimSigning: true,
      // Bounces come back to mail.<domain>, which SES runs. With it, SPF aligns for DMARC
      // as well as DKIM.
      mailFromDomain: `mail.${props.zoneName}`,
      mailFromBehaviorOnMxFailure: ses.MailFromBehaviorOnMxFailure.USE_DEFAULT_VALUE,
    });
    this.emailIdentityName = props.zoneName;

    // DMARC: mail claiming to be from this domain that fails DKIM and SPF goes to spam.
    // No report address (rua=), so no email address is published or committed.
    new route53.TxtRecord(this, 'Dmarc', {
      zone,
      recordName: '_dmarc',
      values: ['v=DMARC1; p=quarantine; adkim=r; aspf=r'],
      ttl: Duration.hours(1),
    });

    new CfnOutput(this, 'NameServers', {
      description: props.stage === 'prod'
        ? 'Paste these 4 into Porkbun: Domain Management -> nutritiondictionary.com -> Authoritative Nameservers'
        : 'Put these 4 in cdk.json as "devNameServers", then redeploy NutritionDictionaryDns-prod from the prod account',
      value: Fn.join(',', zone.hostedZoneNameServers!),
    });
    new CfnOutput(this, 'HostedZoneId', { value: zone.hostedZoneId });
  }
}
