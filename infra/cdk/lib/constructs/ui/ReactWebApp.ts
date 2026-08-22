import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Construct } from 'constructs';

export interface ReactWebAppProps {
  resourcePrefix: string;
  domainName?: string;
  certificateArn?: string;
}

// Private S3 origin fronted by CloudFront (OAC) + the build/deploy step.
//
//   browser --https--> CloudFront --(OAC, SigV4)--> private S3 bucket (SPA)
//
// The bucket stays private; only this distribution may read it. SPA deep links
// work because CloudFront rewrites 403/404 origin responses to /index.html.
// The SPA build reads apps/ui/web/.env.production, written by deploy.sh
// from the Core/Api/Ai stack outputs before this stack deploys.
export default class ReactWebApp extends Construct {
  public readonly distribution: cloudfront.CfnDistribution;
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: ReactWebAppProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    const useCustomDomain =
      !!props.domainName && !props.domainName.includes('cloudfront.net') && !!props.certificateArn;

    this.bucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `${props.resourcePrefix}-webapp-${stack.account}-${stack.region}`,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Origin Access Control — CloudFront signs (SigV4) requests to the bucket.
    const oac = new cloudfront.CfnOriginAccessControl(this, 'OAC', {
      originAccessControlConfig: {
        name: `${props.resourcePrefix}-webapp-oac`,
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
        description: 'OAC for the SPA origin bucket',
      },
    });

    const distributionConfig: any = {
      enabled: true,
      ipv6Enabled: true,
      comment: `${props.resourcePrefix} SPA`,
      defaultRootObject: 'index.html',
      priceClass: 'PriceClass_100',
      origins: [
        {
          id: 's3-webapp',
          domainName: this.bucket.bucketRegionalDomainName,
          originAccessControlId: oac.attrId,
          s3OriginConfig: { originAccessIdentity: '' },
        },
      ],
      defaultCacheBehavior: {
        targetOriginId: 's3-webapp',
        viewerProtocolPolicy: 'redirect-to-https',
        allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
        cachedMethods: ['GET', 'HEAD'],
        compress: true,
        // AWS-managed "CachingOptimized" policy: honors the origin
        // Cache-Control set at upload time.
        cachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6',
      },
      // SPA deep-link fallback. With OAC and no s3:ListBucket, S3 answers
      // missing keys with 403 (AccessDenied), not 404 — map BOTH to the app
      // shell so client-side routes resolve on a hard refresh.
      customErrorResponses: [
        {
          errorCode: 403,
          responseCode: 200,
          responsePagePath: '/index.html',
          errorCachingMinTtl: 10,
        },
        {
          errorCode: 404,
          responseCode: 200,
          responsePagePath: '/index.html',
          errorCachingMinTtl: 10,
        },
      ],
    };

    if (useCustomDomain) {
      distributionConfig.aliases = [props.domainName];
      distributionConfig.viewerCertificate = {
        acmCertificateArn: props.certificateArn,
        sslSupportMethod: 'sni-only',
        minimumProtocolVersion: 'TLSv1.2_2021',
      };
    } else {
      distributionConfig.viewerCertificate = {
        cloudFrontDefaultCertificate: true,
      };
    }

    this.distribution = new cloudfront.CfnDistribution(this, 'Distribution', {
      distributionConfig,
    });

    // Only this distribution (via OAC) may read objects.
    this.bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowCloudFrontServicePrincipalReadOnly',
        actions: ['s3:GetObject'],
        resources: [this.bucket.arnForObjects('*')],
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${stack.account}:distribution/${this.distribution.ref}`,
          },
        },
      })
    );

    // Build the SPA (reads .env.production) and sync it to the bucket, then
    // invalidate the edge cache. The build runs on the HOST (local bundling),
    // not in Docker: the webapp's @seed alias resolves to the repo-root
    // infra/seed, which is outside this asset and unreachable from a container
    // mount — the same reason the Terraform path builds via local-exec.
    const webappPath = path.join(__dirname, '../../../../../apps/ui/web');

    // One shared asset (single build) feeding both deployment passes below.
    const websiteAsset = s3deploy.Source.asset(webappPath, {
      exclude: ['node_modules', 'dist'],
      assetHashType: cdk.AssetHashType.CUSTOM,
      assetHash: Date.now().toString(), // Forces a rebuild on each deploy
      bundling: {
        // Formal fallback only — tryBundle below always handles the build.
        image: cdk.DockerImage.fromRegistry('node:20'),
        local: {
          tryBundle(outputDir: string): boolean {
            execSync('npm install && npm run build', { cwd: webappPath, stdio: 'inherit' });
            fs.cpSync(path.join(webappPath, 'dist'), outputDir, { recursive: true });
            return true;
          },
        },
      },
    });

    // Pass 1: hashed/immutable assets (everything except index.html);
    // prune removes objects no longer in dist/.
    const deployAssets = new s3deploy.BucketDeployment(this, 'WebDeploymentAssets', {
      sources: [websiteAsset],
      destinationBucket: this.bucket,
      exclude: ['index.html'],
      prune: true,
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=31536000, immutable')],
    });

    // Pass 2: the app shell — always revalidate, then drop the old shell /
    // cached routes from the edge.
    const deployIndex = new s3deploy.BucketDeployment(this, 'WebDeploymentIndex', {
      sources: [websiteAsset],
      destinationBucket: this.bucket,
      exclude: ['*'],
      include: ['index.html'],
      prune: false,
      cacheControl: [s3deploy.CacheControl.fromString('no-cache')],
      contentType: 'text/html',
      distribution: cloudfront.Distribution.fromDistributionAttributes(this, 'DistributionRef', {
        distributionId: this.distribution.ref,
        domainName: this.distribution.attrDomainName,
      }),
      distributionPaths: ['/*'],
    });
    // Assets first, shell last — a new shell must never reference missing assets.
    deployIndex.node.addDependency(deployAssets);
  }
}
