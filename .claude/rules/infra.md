---
paths:
  - ".github/**"
  - "infra/**"
  - "services/**"
  - "scripts/**"
  - "**/Dockerfile*"
  - "**/docker-compose*.yml"
  - "**/compose*.yml"
---

# Infrastructure, CI, and deployment rules

One AWS account, everything in eu-central-1. Vendor list: AWS, Expo/EAS, GitHub, Telia. Consult `https://docs.dokploy.com/llms.txt` for Dokploy.

## Infrastructure as code (ADR-001)

- OpenTofu, not Terraform (licence) and not CDK or CloudFormation. Commands are `tofu`. The committed lockfile is OpenTofu's.
- Everything AWS is declared under `infra/`. Resources are never created in the console and imported later; the only click-ops is creating the account and running `infra/bootstrap` once.
- State is in S3, one key per environment, versioned and encrypted, `use_lockfile = true`. DynamoDB locking is deprecated and unused. Treat the state bucket as a secret store.
- Secret values never enter state, which means secret SSM parameters are never declared as resources: the AWS provider stores a SecureString's decrypted value in state on every refresh, and `ignore_changes` only suppresses the diff. Secrets are created once with the CLI (see `infra/README.md`) and referenced by path in IAM policies. Non-secret parameters may be resources. RDS uses `manage_master_user_password = true` so AWS holds the master password; that is the one sanctioned use of Secrets Manager, by RDS and not by the application.
- Every IAM role created under `infra/` sets `permissions_boundary` to the bootstrap boundary policy (output `permissions_boundary_arn`). The apply role refuses to create or modify a role without it.
- The plan role runs on every pull request and is denied `kms:Decrypt`, Secrets Manager reads, log reads, every `s3:GetObject` outside the state bucket, the values of the CloudFront key value stores (ADR-066), and the edge rule's list of the addresses it refuses and its sampled requests (ADR-067). If a plan needs data access, the design is wrong, not the deny.
- CI assumes an AWS role by OIDC. `tofu plan` on every pull request, posted to it; apply to staging on merge to `main`; apply to production only behind the `prod` GitHub environment approval.
- GitHub issues immutable subject claims for this repository (created after 15 July 2026), so the OIDC sub is `repo:kuutti-ry@<owner_id>/kumpa-app@<repo_id>:...`. Trust policies key on the `repository_id` and `repository_owner_id` claims. A name-based `sub` condition copied from older examples will not match.
- Dokploy's own configuration is not in code and cannot be: `user_data` installs it, its contents are backed up from `/etc/dokploy`. That manual step in the recovery path is a live argument in the Dokploy versus Kamal question.
- Run `tofu fmt` before committing. Adding or changing a module needs an ADR or a citation of the TD it follows.
- `docs/architecture/` draws what is deployed (#397): a change to what one of its views draws (a module, an environment, a workflow's step or rights, an outside service) redraws that view and its steps in the same pull request, or a commit message says `Still-true: <view>`, and something planned stays dashed with its issue until it lands. Each view's `<!-- draws` block names its files, and `pnpm check:docs` holds a change to them (ADR-047).

## AWS

- The API authenticates with an EC2 instance role scoped to its bucket, Rekognition detect calls, SES send, and its own SSM parameters. No IAM user, no static keys, ever.
- Secrets live in SSM Parameter Store as SecureString and are fetched at boot. The hetu HMAC key and the Telia signing key never enter the Dokploy control plane, the repo, or CI logs.
- RDS sits in the API's VPC; the security group admits only the API instance. Extended Support declined at creation. 35-day PITR. Manual snapshot before a release-tag migration, deleted within 35 days, as is every snapshot taken by hand or left by a destroy (`kuutti-prod-final`): the privacy policy keeps copies 35 days (#190).
- DNS: the project domain (`kuutti.app`, variable `domain`) is registered through Route 53 in this account; the bootstrap adopts the zone the registration created and declares the domain-wide records (CAA, DMARC, and the root's MX, SPF and Google Workspace's DKIM key and verification, #450; `bootstrap/dns.tf`) and the SES sending identity with its DKIM and MAIL FROM records (`bootstrap/mail.tf`, ADR-043 §5), and each environment declares its own records in `envs/<env>/dns.tf`. No records in the console (the records Amplify Hosting writes for the website, served from `kuutti-ry/kumpa-app-site`, are the documented exception, ADR-001). Google Workspace's records were made there on 2026-10-03 and adopted into `bootstrap/dns.tf` by #450; from then on they change in code. The second domain, `kumpa.fi`, registered the same way and a secondary domain of the Workspace, has its zone adopted in the same file with its MX, Google's verification and its SPF, made with the CLI on 2026-11-16, and Google's DKIM key, a DMARC and a CAA of its own declared there; they too change in code from then on.
- CloudFront: ACM certificate issued in us-east-1; signed URLs for media; cache key excludes the query string for media; the WebSocket behaviour forwards `Sec-WebSocket-*` headers (AllViewer origin request policy). The panel's distribution (`modules/admin`, ADR-025) puts its response-headers policy on every behaviour (a CSP whose `connect-src` is the API's origin alone, `frame-ancestors` and `worker-src 'none'`, no third party), turns 403 and 404 from its private bucket into `/index.html` with 200 so a path is the app (#302); the API's distribution carries a CloudFront Function, viewer-request on its default behaviour, which sets the proof of Kuutti's distribution from a key value store filled by hand (ADR-066); no Lambda@Edge. The API's distribution also carries one AWS WAF web ACL in us-east-1 with one rate rule per address, a signed photo's exact path and the two sign-in starts not counted (`modules/media/edge.json`), metrics only: no WAF logs and no sampled requests, since both keep addresses (ADR-067).
- CloudWatch: billing alarm, EC2 status check, RDS free storage, RDS CPU credit balance, a failed nightly job, the box's free memory (a cron line of `modules/compute`'s headroom script pushes it, ADR-046), the API's refusals and the edge's (#41, ADR-067). Logs via the `awslogs` driver with 30-day retention.
- Not adopted, do not propose: Lambda for images, Redis, RDS Proxy, Secrets Manager (except the RDS master password, ADR-001), EventBridge Scheduler, X-Ray, Cloudflare, Hetzner, Neon.

## Containers

- Build arm64 images in CI (t4g is arm64); never under QEMU. Pinned base image. Verify sharp's arm64 prebuild after any dependency bump.
- The box is stateless: database on RDS, files on S3. It is rebuildable from the Dokploy config.

## CI (GitHub Actions)

- Actions pinned to commit SHAs with a version comment; repository settings reject unpinned actions. `permissions: contents: read` at the top of every workflow, raised per job only when needed.
- The fourteen required checks (`infra/README.md`, Ruleset switch): typecheck, lint, test-api-packages, test-mobile, i18n, licenses, audit, scenarios, schema-drift, compose, issue-link, workflows, DCO sign-off, TruffleHog. arm64 runners for anything that builds images.
- Cloud access from CI through OIDC federation only. No long-lived AWS keys in repository secrets.
- `pnpm install --frozen-lockfile`; `pnpm audit` blocks on high.

## Deploy

- Every merge to `main` deploys staging. Production is a release tag `vX.Y.Z` deployed from the same image. EAS Update channels `staging` and `production` follow the same promotion.
- No pull-request previews (ADR-070): a pull request's image is built and smoke-tested, never pushed; nothing of a pull request runs on the staging box, in the RDS instance, on EAS or in the panel's bucket before it merges. A deploy of an unmerged branch needs a record of its own first.
- Hotfix: branch from the last tag, PR, tag, merge back.
- Dokploy versus Kamal is open; do not switch without an ADR.

## Local dev

- `pnpm env:up` is the entry point; underneath, `docker compose up -d --wait` provides Postgres (with `kuutti_test` from `docker/postgres/init.sql`), versitygw as the S3 stand-in (an S3 gateway over a directory; MinIO's community images were withdrawn in September 2026), and the mock IdP (`navikt/mock-oauth2-server`, issuer `ftn`) whose login page has a button for each demo persona and a form for arbitrary FTN claims (ADR-014). The personas exist at the mock bank only: never a demo parameter, route or picker in the API or the app. Every published port binds to 127.0.0.1. The real Telia test bed is wired only on staging.
