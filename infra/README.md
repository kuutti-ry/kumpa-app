# Infrastructure

OpenTofu, AWS, one account, eu-central-1. See `docs/adr/001-infrastructure-as-code.md` for why, and `.claude/rules/infra.md` for the standing rules.

Commands below use `tofu`. Terraform is command-compatible if you have it instead, but the committed lockfile is OpenTofu's.

## Layout

| path | contents | when |
|---|---|---|
| `bootstrap/` | state bucket, GitHub OIDC provider, CI roles, budget and billing alarm, the hosted zones of the project domain, of `kumpa.fi` and of its misspelling `kunpa.fi` (#726), an SES identity for each of the first two (#385, ADR-043; #703, ADR-072) | once, before anything else |
| `modules/` | `network`, `compute`, `data` (#7); `observability` (#11); `media` (#48, ADR-005: live on staging since 2026-10-09, dormant in production until its cutover below); `admin` (#313, ADR-025: the moderation panel's host, composed by both environments, live in production since 2026-11-05) | as the work needs them |
| `envs/staging`, `envs/prod` | one composition per environment: the modules plus the non-secret parameters | #7 |
| `github/` | repository settings, branch protection, environments | not adopted; `gh api` below until the GitHub provider question is settled |

Modules arrive with the work that needs them: network, compute and data (#7); observability (#11); media and delivery (#48, ADR-005); the moderation panel's host (#313, ADR-025). Mail needed no module: its SES identity belongs to the domain rather than an environment, so it went to the bootstrap, and each environment adds a statement to its instance role and a parameter (Mail, below; #385, ADR-043, TD-18). `scripts/` holds the one-time procedures that are deliberately not resources.

## Account, once (console, maintainer only)

Everything in this section is click-ops by design: it is the part ADR-001 allows, and it happens before any code can run. Do it in this order; the click-by-click version, including the stopgap mailbox while the project domain has no mail, is `docs/runbooks/aws-account-setup.md`.

1. **Create the account.** Root email is a re-pointable alias on the project domain, never a personal address (TD-4); until the domain has mail, a dedicated mailbox created for the project, re-pointed later from account settings. Account name `kuutti`. Set the billing, operations and security alternate contacts to project addresses too.
2. **Secure root.** Hardware MFA on root, no root access keys. `aws iam get-account-summary` must later show `AccountMFAEnabled: 1` and `AccountAccessKeysPresent: 0`.
3. **Paid account plan**, chosen at sign-up. Free-plan accounts close after six months or when the credits run out (TD-19), and enabling Identity Center (step 5) creates an organisation, which force-upgrades a free-plan account anyway and expires the sign-up credits on either plan. Billing must show no free-plan banner.
4. **Enable billing metrics.** Billing and Cost Management → Billing preferences → Alert preferences → *Receive CloudWatch Billing Alerts*. One-way switch; the metric appears about 15 minutes later. The bootstrap's billing alarm reads it.
5. **Admin access for the bootstrap apply.** **IAM Identity Center** (ADR-001, admin access): one user for the maintainer, one permission set (`AdministratorAccess`), MFA required by the identity store, sessions issued by `aws configure sso`. No IAM user and no long-lived access key ever exist. Enabling Identity Center creates an organisation with this account as its management account; see step 6 for what that means at transfer time. A single IAM user with MFA and console-issued session credentials is the fallback only if Identity Center cannot be enabled.
6. **The domain.** `kuutti.app`, registered 2026-09-17 through Route 53 in this account (Registered domains, Register domains) with the project mailbox as registrant contact; auto-renew, transfer lock and privacy protection on. ICANN requires the registrant address to be verified within 15 days of registration or the domain is suspended: `aws route53domains get-contact-reachability-status --region us-east-1 --domain-name kuutti.app` must say `DONE`; while it says `PENDING`, click the link in the mail to the project mailbox (`resend-contact-reachability-email` if it has lapsed). A purchase with contact details cannot be code. The hosted zone Route 53 creates at registration is adopted by the bootstrap (`bootstrap/dns.tf`, an import block), and every record is declared by the environment that owns its target (`envs/<env>/dns.tf`). The domain moves with the account; it is one variable (`domain`) per root if it ever changes, which stays cheap until verified links bind it (#36; in the native batch, #184).
7. **Later, nothing to do now:** the account moves under an organisation owned by the association (TD-4). Because Identity Center made this account the management account of its own organisation, that move means deleting this one-account organisation and its Identity Center instance first, then accepting the association's invitation and re-creating admin access there (ADR-001). Root email and alternate contacts re-point; nothing under `infra/` changes.

## Tools

```sh
brew install opentofu awscli
pnpm aws:login
```

`aws:login` (`scripts/aws-login`) writes the Identity Center profile on first use and signs in whenever the session has expired; the runbook's section 6 describes what it configures.

Sign in from your own terminal. An agent working in this repository never types, reads or prints credentials and never opens `~/.aws/*`; it only runs `tofu` and `aws` commands that use the session you already hold.

## Bootstrap, run once

GitHub's immutable subject claims mean the trust policy keys on numeric IDs, not names. Get them:

```sh
gh api repos/kuutti-ry/kumpa-app --jq '{repo_id: .id, owner_id: .owner.id}'
```

Then:

```sh
cd infra/bootstrap
cp terraform.tfvars.example terraform.tfvars
tofu init
tofu apply
```

Fill in the two GitHub IDs and the billing alias in `terraform.tfvars` before the apply. This runs with local state, because the bucket it creates is where state will live. The apply also creates the monthly budget (TD-4: 50 EUR, expressed as `monthly_budget_usd` because the billing metric is USD-only; 150 USD, counted before credits, since production runs beside staging, ADR-049), the CloudWatch billing alarm in us-east-1, and the SNS topic both notify. AWS mails a subscription confirmation to the billing alias: confirm it, then send the test notification:

```sh
aws sns publish --region us-east-1 --topic-arn "$(tofu output -raw billing_topic_arn)" \
  --subject 'kuutti billing test' --message 'delivery check'
```

Migrate the state immediately afterwards:

Put `tofu output -raw state_bucket` into the backend block of `versions.tf` and uncomment it, then:

```sh
tofu init -migrate-state
rm -f terraform.tfstate terraform.tfstate.backup
tofu plan
```

The plan must report no changes.

Commit `versions.tf` and `.terraform.lock.hcl`. The lockfile carries hashes for every platform the provider ships, so developer machines and both runner architectures init from it unchanged.

Later changes to `bootstrap/` are applied the same way, by the maintainer: it owns the CI roles, so CI cannot apply it.

`terraform.tfvars` and any `*.tfstate` are gitignored. The state bucket holds secrets: it is versioned, encrypted, public access is blocked, and only the CI roles and the maintainer can read it.

About 24 hours after the first apply the `Project` tag shows up in Cost Explorer; activate it as a cost allocation tag then (it cannot be activated before it has appeared in billing data, which is why it is not a resource here):

```sh
aws ce update-cost-allocation-tags-status --cost-allocation-tags-status TagKey=Project,Status=Active
```

## After bootstrap: GitHub

The bootstrap outputs are not secret, so they go into repository **variables**. CI reads `vars.*`; no AWS credential exists in any repository or environment secret.

```sh
cd infra/bootstrap
gh variable set AWS_REGION --body eu-central-1
gh variable set TF_STATE_BUCKET --body "$(tofu output -raw state_bucket)"
gh variable set AWS_PLAN_ROLE_ARN --body "$(tofu output -raw ci_plan_role_arn)"
gh variable set AWS_APPLY_ROLE_ARN --body "$(tofu output -raw ci_apply_role_arn)"
gh variable set AWS_PERMISSIONS_BOUNDARY_ARN --body "$(tofu output -raw permissions_boundary_arn)"
```

The apply role trusts exactly two subjects, `environment:staging` and `environment:prod`, so the production approval lives in GitHub's environment protection, not in AWS. Create the environments with the same names (the GitHub Terraform provider is not adopted; `infra/github/` stays empty until that question is settled):

```sh
R=repos/kuutti-ry/kumpa-app
# staging: deployable from main only, no reviewers
gh api -X PUT "$R/environments/staging" --input - <<'JSON'
{"wait_timer":0,"reviewers":[],"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
gh api -X POST "$R/environments/staging/deployment-branch-policies" --input - <<'JSON'
{"name":"main","type":"branch"}
JSON

# prod: the maintainer approves, tags v* only
gh api -X PUT "$R/environments/prod" --input - <<'JSON'
{"wait_timer":0,"prevent_self_review":false,"reviewers":[{"type":"User","id":9991098}],"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
gh api -X POST "$R/environments/prod/deployment-branch-policies" --input - <<'JSON'
{"name":"v*","type":"tag"}
JSON

# check
gh api "$R/environments" --jq '.environments[] | {name, rules: [.protection_rules[] | {type, reviewers: [.reviewers[]?.reviewer.login]}]}'
for e in staging prod; do gh api "$R/environments/$e/deployment-branch-policies" --jq ".branch_policies[] | \"$e: \\(.type) \\(.name)\""; done
```

`9991098` is the maintainer's user id (`gh api users/superseacat --jq .id`). `prevent_self_review` stays off while the maintainer is the only reviewer.

### Ruleset switch (#8, last)

With the checks on `main`, the ruleset `23053522` carries a pull-request rule and the required checks, and direct pushes have ended. Code-owner review stays off: the only code owner is the maintainer, and an author cannot approve their own pull request, so requiring it would block every merge.

```sh
gh api -X PUT repos/kuutti-ry/kumpa-app/rulesets/23053522 --input - <<'JSON'
{"name":"Protect main","target":"branch","enforcement":"active",
 "bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}],
 "conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},
 "rules":[
  {"type":"deletion"},{"type":"non_fast_forward"},{"type":"required_linear_history"},
  {"type":"pull_request","parameters":{"required_approving_review_count":1,"dismiss_stale_reviews_on_push":true,"require_code_owner_review":false,"require_last_push_approval":false,"require_extra_approval_for_unattributed_changes":true,"required_review_thread_resolution":false,"allowed_merge_methods":["squash"]}},
  {"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":true,"required_status_checks":[
   {"context":"typecheck"},{"context":"lint"},{"context":"test-api-packages"},{"context":"test-mobile"},{"context":"i18n"},{"context":"licenses"},{"context":"audit"},{"context":"scenarios"},{"context":"schema-drift"},{"context":"compose"},{"context":"issue-link"},{"context":"workflows"},{"context":"DCO sign-off"},{"context":"TruffleHog"}]}}
 ]}
JSON
```

The rules above are the live ones as of 2026-09-26: fourteen checks, `i18n` (#13) and `licenses` (#16) among them; one approving review since the `contributors` team got write (2026-09-25), and one more for changes no person is attributed to, such as a pull request Copilot's coding agent wrote (`require_extra_approval_for_unattributed_changes`); approvals are dismissed when new commits arrive (the native review of #55 relies on that); squash merges only. `dependency review` runs on every pull request without being required. The ruleset on GitHub is the source of truth (`gh api repos/kuutti-ry/kumpa-app/rulesets/23053522`), and a PUT replaces all of it, `bypass_actors` included: the snippet carries the live value, repository role 5 (admin) bypassing always, which only an admin token can read back, so compare before a PUT. `required_review_thread_resolution` is off, although #8 item 7 asked for it: with a bot reviewing pull requests (Copilot did, until 2026-09-29), an unresolved bot thread would block every merge until someone clicked; turning it on is a one-line change here and in the live rule, the maintainer's call. A change to the ruleset updates this snippet, `CLAUDE.md` (Git) and `CONTRIBUTING.md` in the same pull request.

### Hardening settings (#16), maintainer only

Settings of the repository and the organisation exist only on GitHub, so the commands live here; `export.yml` copies the results out weekly. An agent never runs these (CLAUDE.md, Git).

**Tag ruleset.** A `v*` tag deploys production, so creating, moving and deleting one is for repository admins only:

```sh
gh api -X POST repos/kuutti-ry/kumpa-app/rulesets --input - <<'JSON'
{"name":"Protect release tags","target":"tag","enforcement":"active",
 "bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}],
 "conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}},
 "rules":[{"type":"creation"},{"type":"update"},{"type":"deletion"}]}
JSON
```

`actor_id` 5 is the built-in repository admin role. Check: a member with write access and no bypass is refused when pushing `v0.0.0-test`, with the rule named in the error.

**Code scanning, secret scanning, Actions allow-list:**

```sh
R=repos/kuutti-ry/kumpa-app
gh api -X PATCH "$R/code-scanning/default-setup" -f state=configured -f 'languages[]=actions' -f 'languages[]=javascript-typescript'
gh api -X PATCH "$R" --input - <<'JSON'
{"security_and_analysis":{"secret_scanning_non_provider_patterns":{"status":"enabled"},"secret_scanning_validity_checks":{"status":"enabled"}}}
JSON
gh api -X PUT "$R/actions/permissions/selected-actions" --input - <<'JSON'
{"github_owned_allowed":true,"verified_allowed":false,"patterns_allowed":[
 "docker/build-push-action@*","docker/setup-buildx-action@*","docker/metadata-action@*","docker/login-action@*",
 "trufflesecurity/trufflehog@*","ossf/scorecard-action@*"]}
JSON
```

"Any verified creator" is a far larger set than the six we run. `actions/*` and `github/*` (checkout, cache, setup-python, dependency-review, attest-build-provenance, codeql-action) stay allowed as GitHub-owned. After the change every workflow must still run green on `main`; a workflow that names an action outside the list fails at start-up with the action named.

**Actions approve nothing.** "Allow GitHub Actions to create and approve pull requests" is off for the organisation since 2026-11-07 (#609, the audit's record 5): with it on, a workflow pushed to any branch by a member with write could approve its author's pull request with `GITHUB_TOKEN`, and so could the pull-request jobs that hold `pull-requests: write` to comment. Read it back per repository: `gh api repos/kuutti-ry/kumpa-app/actions/permissions/workflow` shows `can_approve_pull_request_reviews` false. No workflow approves; `auto-approve.yml` went with the decision, and the maintainer merges their own pull requests with the admin bypass (`docs/architecture/delivery.md`, Open).

**Organisation** (an owner; `gh auth refresh -s admin:org` to read these through the API). Verify `kuutti.app`: Settings, Verified and approved domains, Add a domain; put the record name and code into `infra/bootstrap/terraform.tfvars` (`github_domain_verification`), `tofu apply` in `infra/bootstrap`, then press Verify. New-repository security defaults (Dependabot alerts, secret scanning, push protection) on. Third-party application access restricted, applications approved by an owner. Fine-grained personal access tokens require approval; classic tokens have no access to the organisation. Organisation Actions policy equal to the repository's. Review the six members: role in the organisation, role on this repository, nobody holding more than the work needs; write the result into #16.

**Build provenance.** `build.yml` signs a provenance attestation for every image it pushes from `main`, and again under the tag when a release retags that digest (job `attest`). Before deploying an image by hand, in a recovery, check that it is one of ours, built by that workflow from that ref:

```sh
gh attestation verify oci://ghcr.io/kuutti-ry/kuutti-api:<sha> --repo kuutti-ry/kumpa-app \
  --signer-workflow kuutti-ry/kumpa-app/.github/workflows/build.yml --source-ref refs/heads/main
# a release: oci://...:vX.Y.Z with --source-ref refs/tags/vX.Y.Z
```

An image built from 2026-10-03 to 2026-11-16 was attested while this repository was `kuutti-ry/kuutti-app` (#702): verify it with `--repo kuutti-ry/kuutti-app --signer-workflow kuutti-ry/kuutti-app/.github/workflows/build.yml`. An image built before 2026-10-03 was attested when the organisation was still `kuutti-fi` (#110), and its certificate says so: verify it with `--repo kuutti-fi/kuutti-app --signer-workflow kuutti-fi/kuutti-app/.github/workflows/build.yml`, at the image's present path `ghcr.io/kuutti-ry/kuutti-api`. With the new name it is refused. The old name proves less than it did, because a name can change hands and the IDs cannot: for such an image, read the IDs the certificate carries as well and hold them against this repository's (`gh api repos/kuutti-ry/kumpa-app --jq '{repo_id: .id, owner_id: .owner.id}'`):

```sh
gh attestation verify oci://ghcr.io/kuutti-ry/kuutti-api:<sha> --repo kuutti-fi/kuutti-app \
  --signer-workflow kuutti-fi/kuutti-app/.github/workflows/build.yml --source-ref refs/heads/main \
  --format json --jq '.[].verificationResult.signature.certificate | {sourceRepositoryIdentifier, sourceRepositoryOwnerIdentifier}'
```

`--repo` alone is not enough: a pull request from this repository runs its own copy of `build.yml` and could push and attest an image under any tag. Its certificate carries `refs/pull/<n>/merge`, so `--source-ref` refuses it, and `--signer-workflow` refuses any other workflow file. Images built before #16 landed have no attestation.

**A deploy by hand, and a migration the database refuses (#722, ADR-075).** A rehearsal or a recovery deploys the verified image with `.github/scripts/dokploy-deploy.sh` (the environment's `DOKPLOY_URL`, `DOKPLOY_TOKEN` typed in with `read -rs DOKPLOY_TOKEN && export DOKPLOY_TOKEN` so it is never on a command line, `DOKPLOY_APPLICATION_ID`, and `IMAGE` at the verified tag). It is done only when `API_URL=<the environment's API> COMMIT=<short sha> .github/scripts/wait-healthy.sh` says so, the same check `deploy.yml` runs after it. Dokploy reports a deployment as finished once Swarm has the new task's spec, whether or not that task ever starts. On 2026-11-17 it said finished while the new image's boot had stopped in its migrations, and `/health` went on naming the old commit. The commit `/health` names is the proof, never Dokploy's word.

Before a release whose image carries migrations the database has not run, take the manual snapshot (`.claude/rules/db.md`): `aws rds create-db-snapshot --db-instance-identifier kuutti-prod --db-snapshot-identifier kuutti-prod-before-<the tag, dots as dashes>`, deleted within 35 days like every snapshot taken by hand (#190).

The boot applies each pending migration in its own transaction, in the journal's order. When the database refuses one, the new task exits before it listens. The last lines of `sudo docker service logs --tail 50 <env>-api-<id>` read `Error: migration <tag> failed and was rolled back; this run applied <n> before it`, with the database's error under `[cause]`, by its kind alone (its code, and the schema, table, column and constraint it names), never its words, which can quote a row. Those `<n>` migrations stay applied, with their lines in the journal; the refused one and every later one are not applied. Swarm keeps the old task, which now serves a database ahead of its own schema. Its `/health` names its own commit and says `migrations: current`, because it reads the database against its own shorter journal. Read the cause. The fix lands on `main` and comes with a new tag, and its boot carries on from the refused migration. If `db-audit-owner.sh <env> release` was run for this release (the audit table's role boundary, under Photo moderation), run `db-audit-owner.sh <env>` again meanwhile, so the audit log is not left the application role's. If the old image cannot serve the database where it stopped, the snapshot is the way back: `docs/runbooks/incident.md`, Bringing a restored database into service. A boot whose connection drops midway (an RDS reboot or failover) logs the connection's error instead; what committed is what `drizzle.__drizzle_migrations` holds, and the next boot carries on from there.

### Restoring from an export

`export.yml` writes `s3://<state bucket>/github-export/<date>/` every Sunday: `issues.json`, `issue-comments.json`, `pulls.json`, `pull-comments.json`, `pull-reviews.json`, `milestones.json`, `labels.json`, `rulesets.json`, `environments.json`, `environment-branch-policies.json`, `manifest.json` and `repository.bundle`. Its role (`kuutti-ci-export`) trusts the `main` branch only, can add objects under that prefix and nothing else, and cannot delete; the bucket is versioned and replaced versions are kept a year. After applying the bootstrap, once: `gh variable set AWS_EXPORT_ROLE_ARN --body "$(cd infra/bootstrap && tofu output -raw ci_export_role_arn)"`; the workflow stays dormant until then. To restore into a new or scratch repository (`NEW=owner/name`, signed in with `pnpm aws:login`):

```sh
B=$(cd infra/bootstrap && tofu output -raw state_bucket)
# One version per object is the rule: a second version under a date means something overwrote the export.
aws s3api list-object-versions --bucket "$B" --prefix "github-export/<date>/" --query 'Versions[].[Key,VersionId,IsLatest,LastModified]' --output table
aws s3 cp "s3://$B/github-export/<date>/" export/ --recursive
git clone export/repository.bundle restored && git -C restored remote set-url origin "https://github.com/$NEW.git" && git -C restored push --all origin && git -C restored push --tags origin
jq -c '.[] | {name, color, description}' export/labels.json | while read -r l; do gh api -X POST "repos/$NEW/labels" --input - <<< "$l" || true; done
jq -c '.[] | {title, state, description, due_on}' export/milestones.json | while read -r m; do gh api -X POST "repos/$NEW/milestones" --input - <<< "$m"; done
# Every number from 1 to the highest, so that #n stays #n while nothing else has been created. Pull requests
# are in the list too (they have a pull_request key) and come back as placeholder issues; a number GitHub no
# longer has (deleted, such as #158 and #230) gets a placeholder of its own. A number the list holds twice
# (a page shifted during the export) comes back once.
jq -c 'INDEX(.number) as $by | range(1; (map(.number) | max) + 1) as $n | $by["\($n)"] as $i
  | if $i then {title: $i.title, body: (($i.body // "") + "\n\n_Restored from the export; originally #\($n) by @\($i.user.login), \($i.created_at)._"), labels: [$i.labels[].name]}
    else {title: "#\($n): not in the export", body: "Deleted on GitHub before the export; kept so that the numbers after it stay theirs.", labels: []} end' export/issues.json \
  | while read -r i; do gh api -X POST "repos/$NEW/issues" --input - <<< "$i" --jq .number; sleep 1; done
jq -c '.[] | del(.id, .source, .source_type, .node_id, ._links, .created_at, .updated_at, .current_user_can_bypass)' export/rulesets.json | while read -r r; do gh api -X POST "repos/$NEW/rulesets" --input - <<< "$r"; done
```

Comments (`issue-comments.json`, each with its `issue_url`) are posted the same way through `repos/$NEW/issues/<n>/comments`; closed issues and the placeholders of missing numbers are closed afterwards with `gh issue close`. A pull request cannot come back as one under its number (an open one can be opened again from its branch, under a new number): its placeholder issue keeps the number and the body, and `pulls.json` is the record of the rest. There `state` is open or closed, and a pull request was merged when `merged_at` is set; only then is `merge_commit_sha` the commit that landed on `main`, while for a closed, unmerged one it is a test merge that is not in the bundle. Of its branches the names and head SHAs are kept; a merged branch's own commits are not in the bundle, since the branch is deleted on merge. The comments on its diff (`pull-comments.json`, with `path`, `line` and `diff_hunk`, a reply naming its parent in `in_reply_to_id`) carry a `pull_request_url` and are posted on the placeholder like the issue comments, with the path and the line written into the text. So are its reviews (`pull-reviews.json`), with the verdict (`state`), the reviewer and `submitted_at` in front of the text; a `COMMENTED` review with an empty body is only the envelope of its diff comments and is skipped, since GitHub refuses an empty comment. An export whose `issues.json` holds no pull request cannot keep the numbering; the workflow fails such a run (#16; the first export, of 2026-10-25, was one). Environment protection rules are re-created with the `PUT .../environments/<name>` commands of this file; `environments.json` is the record of what they were. Secrets are not in the export and never can be: they are re-entered from the password manager (`docs/runbooks/custody.md`).

## Verify

`.github/workflows/infra-oidc.yml` keeps three properties of the plan role proven on every infrastructure change: it is assumable from a pull request and from `main`, it cannot decrypt a SecureString even though `ReadOnlyAccess` would allow it, and it is refused every other read that `ci_plan_deny_data` denies (`.github/scripts/plan-role-denies.sh`, with one probe per denied action; a deny declared but not yet applied fails it until the bootstrap is applied). It needs one throwaway parameter:

```sh
aws ssm put-parameter --name /kuutti/ci-check/secret --type SecureString --value not-a-secret
```

The environment gates are checked once, by dispatching the same workflow with the `gate` input: from a `v*` tag with `gate=prod` the job waits for the reviewer before assuming `kuutti-ci-apply`; from any branch other than `main` with `gate=staging` GitHub refuses the ref before the job starts. Delete the tag afterwards.

Done when: `aws iam get-account-summary` shows MFA on and no access keys; the test notification arrived; `tofu plan` in `bootstrap/` on the S3 backend shows no changes and no local state file exists; the workflow is green on a pull request with `AccessDenied` visible in the decrypt step; both gate checks behaved; `gh variable list` shows the five variables and `gh secret list` shows no AWS credential; Billing shows the paid plan.

## Environments

```sh
cd infra/envs/staging
tofu init
tofu plan
```

The same in `infra/envs/prod`. Applies run through CI (#8): plans on every pull request, staging on merge to `main`, production only after approval on the `prod` GitHub environment. A local plan needs the SSO session; a local apply is not the path.

### CI

| workflow | trigger | role | does |
|---|---|---|---|
| `infra.yml` | pull requests and `main` touching `infra/**` | `kuutti-ci-plan` | `fmt` for everything, `validate` and `plan` for `envs/staging` and `envs/prod`; each plan is a sticky comment on the pull request; on `main` it then applies `envs/staging` behind the `staging` environment with `kuutti-ci-apply` |
| `infra-prod.yml` | `v*` tags | `kuutti-ci-apply` | applies `envs/prod` after the `prod` reviewer approves |
| `infra-oidc.yml` | changes under `infra/**` | `kuutti-ci-plan` | proves the plan role still cannot decrypt a SecureString, nor make any read `ci_plan_deny_data` denies |
| `eas-build.yml` | `main` (fingerprint changed), `v*` tags, by hand | none (GitHub environment `staging` or `prod`) | native builds on EAS: `development` when the fingerprint of `main` differs from the last development build's, `production` on a tag, `preview` and `staging` by hand; links on the pinned builds issue (`apps/mobile/README.md`) |
| `build.yml` | every push and pull request | none | builds the API image on arm64 and smoke-tests it; on `main` pushes `ghcr.io/kuutti-ry/kuutti-api:<sha>` and `:main` (a pull request's image is built and tested, never pushed, ADR-070), on a tag retags that same image as `:vX.Y.Z`, then calls `deploy.yml` (Dokploy, `/health`, then the EAS Update to the environment's channel, #10), `admin-deploy.yml` and, for tags, `release.yml` |
| `admin-deploy.yml` | called by `build.yml` after each deploy; by hand from `main` or a `v*` tag | none for the build; `kuutti-ci-apply` for the upload (GitHub environment `staging`, or `prod` behind its reviewer) | builds the moderation panel against the environment's API in a job that holds no credentials, and a second job syncs that build to the root of the panel's bucket (never under `fonts/`), invalidates the distribution and checks the served page, its headers and the API's CORS for the panel's origin (ADR-025 §5) |

OpenTofu and the OIDC exchange are installed by `.github/scripts/install-tofu.sh` and `aws-oidc.sh`; no third-party action touches credentials. The bootstrap is neither planned nor applied by CI: its inputs are in the maintainer's tfvars, and its plan is the maintainer's drift check.

The staging apply and the staging deploy run only while the repository variable `STAGING_ENABLED` is `true` (`gh variable set STAGING_ENABLED --body true`). Until the maintainer sets it, every merge plans and builds but applies and deploys nothing: staging starts when there is something to deploy, prod at a `v*` tag (first applied by the rehearsal tag of 2026-10-24, ADR-049).

Until an environment's `media_enabled` is set (Media, below), TLS terminates at Traefik on the box and the API answers on the Elastic IP directly (#7).

Each environment composes the three modules (#7, TD-19) and the panel's host (#313, ADR-025):

| module | creates | notes |
|---|---|---|
| `network` | VPC /16, one public subnet, two private subnets, DB subnet group, `api` and `db` security groups | no NAT; `db` admits 5432 from the `api` group only; port 22 only for `ssh_cidrs`, empty by default |
| `data` | RDS PostgreSQL 17 single-AZ, gp3 20→100 GB, 35-day PITR, `rds.force_ssl=1`, Extended Support declined, master password held by AWS | staging `db.t4g.micro`, prod `db.t4g.small` with deletion protection and a final snapshot |
| `compute` | t4g.small on staging, t4g.medium in production, Ubuntu 24.04 arm64, Elastic IP, IMDSv2, instance role `kuutti-api-<env>` under the boundary, log group `/kuutti/<env>/api`, first-boot script installing Dokploy | staging also owns the account-wide Session Manager preferences, `/kuutti/ssm-sessions` |
| `admin` | private bucket `kuutti-admin-<env>-<account>`, CloudFront distribution on `admin.staging.<domain>`, or `admin.<domain>` in production, with the panel's headers and the path fallback, ACM certificate in us-east-1, alias records | Admin panel, below |

The composition then writes the non-secret parameters `app-env`, `log-level`, `db-host`, `db-port`, `db-name`, `db-user` under `/kuutti/<env>/`, and, once `telia_client_id` has a value, `oidc-issuer`, `oidc-client-id`, `oidc-redirect-uri` and `oidc-acr-values` (#32, `docs/vendors/telia.md`); the API turns them into `APP_ENV`, `DB_HOST` and so on at boot and composes `DATABASE_URL` with `sslmode=require`.

Every IAM role declared in an environment or module sets `permissions_boundary` to the bootstrap output `permissions_boundary_arn`; the apply role refuses to create a role without it. The plan role cannot read secrets, logs, or object data, only resource metadata and state.

### Media (#48, ADR-005)

`infra/modules/media`, composed by each environment behind `media_enabled` (default `false`): the private media bucket `kuutti-media-<env>-<account>` (SSE-S3, versioning off so an erased photo is gone, a policy that lets only the distribution read `media/*`), the instance role's right to write and remove objects under `media/`, the CloudFront distribution on `api.<env>.<domain>` with the API as its default origin and the bucket behind `/media/*`, the key group for signed URLs, the ACM certificate in us-east-1, the web ACL of the edge's rate rule (below), and the alias records. The API signs URLs for fifteen minutes (a photo sent in a conversation, up to twenty, ADR-031 §10) with the private key from SSM; `apps/api/src/media/` is the code. The module writes `s3-bucket`, `media-url-base` and `cloudfront-key-pair-id` under `/kuutti/<env>/` for the API.

Cutover, once per environment, maintainer only. The key pair first, offline like the other keys:

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /Volumes/<offline-medium>/kuutti-<env>-cloudfront-signing.pem
openssl pkey -in /Volumes/<offline-medium>/kuutti-<env>-cloudfront-signing.pem -pubout -out infra/envs/<env>/cloudfront-signing-key.pub.pem
aws ssm put-parameter --name /kuutti/<env>/cloudfront-signing-key --type SecureString --value "$(cat /Volumes/<offline-medium>/kuutti-<env>-cloudfront-signing.pem)"
```

Then give the `api` application in Dokploy a second domain, `origin.api.<env>.<domain>` with Let's Encrypt (Domains tab, same as `api.<env>` in `dokploy-setup.sh`): CloudFront connects to the box by that name and Traefik must present a certificate for it, while the `api.<env>` router keeps serving the forwarded Host. Commit the public key and `media_enabled = true` in `envs/<env>/terraform.tfvars.example`'s real counterpart (CI passes it through the environment's tfvars; for staging, set it in `envs/staging/main.tf`'s variable default if the tfvars is not in CI), push, and let the apply run: it creates the bucket, the certificate (validated by a record in the zone, a few minutes), the distribution (about ten minutes), moves `api.<env>` from the Elastic IP to the alias, points `origin.api.<env>` at the box, and writes the three parameters. The next deploy of the API logs `"mode":"cloudfront"` under `media`. Checks: `/health` through `api.<env>` answers; an upload from the phone appears as three objects under `media/<key>/` in the bucket and nothing else; the URL the app receives opens once and answers 403 without its query string or after fifteen minutes; `photo_access` has a row per URL.

The same distribution fronts the rest of what the box serves on 443, as `extra_aliases` of the module: `dokploy.<env>` (`deploy.yml` calls Dokploy's API there; #198, ADR-005 §7). Its record in `envs/<env>/dns.tf` points at the distribution while `media_enabled` is on, and at the Elastic IP while it is off; Traefik routes it by the forwarded Host. One behaviour, `/.well-known/acme-challenge/*`, goes to the box's port 80 over plain HTTP with the Host alone of what the viewer sent (its own origin request policy: no cookie, other header or query string), so that Traefik's HTTP-01 renewals of the names behind the distribution reach its challenge router (under the default behaviour they would be redirected to HTTPS and reach the API); `origin.api.<env>` points at the box, so its own challenge comes straight. `cloudfront_only_ingress` (network module) closes 443 to CloudFront's prefix list: on staging since #198, in production at its cutover.

**Anti-scraping and the order of the switches (#52, ADR-008 §5).** Three switches belong together, and the order matters. The origin request policy forwards the CloudFront headers, so the API sees `CloudFront-Viewer-Address`; the rate limiter reads it only when `trusted-proxy` says `cloudfront` (`trusted_proxy` in `envs/<env>/main.tf`), and that flips in the same apply as `cloudfront_only_ingress`, never before: until the box admits CloudFront alone, anyone reaching the origin could send the header. And `media_enabled` does not go first: between the cutover and the ingress switch every request would reach Traefik from a CloudFront edge, the limiter (still in `traefik` mode, keyed on the last `X-Forwarded-For` hop) would count per edge address, and people behind one edge would share a bucket. So the follow-up above (Dokploy behind the distribution) precedes the cutover, and the cutover commit sets all three; since #198 that waits for a proof of Kuutti's distribution (below). Staging went first regardless, on 2026-10-09 (ADR-005 and ADR-008, History). With #198 Dokploy went behind the distribution and the box admits CloudFront's servers alone; `trusted-proxy` stayed `traefik`, because the prefix list is every CloudFront distribution's and anybody's distribution may send `CloudFront-Viewer-Address` with a value of its own. So the limiter keyed on the CloudFront server that forwarded a request, and the team shared a bucket per edge, until the box could tell Kuutti's distribution from anybody's (ADR-066, below). On staging that came with #198's last change: `trusted-proxy` is `cloudfront`, and the limiter keys on each viewer's address from a request carrying the proof. The API reads `trusted-proxy` at boot: turning it on takes that proof first, then the parameter and a deploy, after which the request lines carry `cfRequestId`; turning it off takes the parameter and a deploy before 443 opens again. Dokploy, behind the distribution as well, sees the edge as its peer. Production keeps the order, and its composition already puts `dokploy.kuutti.app` behind the distribution once media is on, so its cutover commit can set all three once that proof exists; in that one apply the box refuses its address on 443 from the moment the rule changes, while the records still move with the distribution, so production and its Dokploy answer nobody for as long as the certificate's validation and the distribution's creation take, ten minutes or more, and a name cached against the Elastic IP for up to five more. The observability module's `PhotoBudgetRefusals` metric and its alarm (`budget_refusals_per_day`, 100) count the API's `photo refused` lines; to see the alarm trip on staging, sign in on a phone, set a small `photo_fetches_per_day` in `matching_config` and reload the grid a hundred times, then restore the row as a new version.

**The proof of Kuutti's distribution (ADR-066).** The box admits every CloudFront distribution's servers, so Kuutti's proves itself: its CloudFront Function (`modules/media/origin-proof.js`) sets `x-kuutti-origin` on every request of the default behaviour from the key `origin-secret` of the environment's key value store, `kuutti-<env>-origin-proof`, after removing a viewer's own. The API reads the same value from the SecureString `/kuutti/<env>/origin-secret`, and in `cloudfront` mode believes `CloudFront-Viewer-Address` only from a request carrying it; it refuses to boot in that mode without the secret. OpenTofu declares the store and the function, never the key, so the value is in no state (ADR-001). Once per environment, in this order, the maintainer's:

1. `tofu apply` in `infra/bootstrap`, so CI's plan role may not read the store (`ci_plan_deny_data`) before a value is in it.
2. Make the value and write it to SSM and then to the store with section 17's first-time command (`docs/runbooks/rotation.md`; the value needs no other copy, a lost one is replaced), then redeploy the API.
3. `curl -s https://api.<env>.kuutti.app/health` says `"originProof":"valid"`. `missing` means the function sent nothing (no key, no function, or a failed read), `wrong` that the two differ.
4. Only then `trusted_proxy = "cloudfront"` in `envs/<env>/variables.tf`, in a pull request of its own, with the probe's `health_search_string` set to `"originProof":"valid"`. After its deploy, `/health` says `"trustedProxy":"cloudfront"`. Staging went through all four with #198, the switch in version 0.110.1.

Production's function exists only from its cutover (`modules/media`, behind `media_enabled`), so step 3 cannot be seen there beforehand, and the switch is the cutover commit itself, with `media_enabled` and `cloudfront_only_ingress`. There, after steps 1 and 2:

- Compare the two copies by their digest, without the function:

  ```sh
  arn=$(aws cloudfront describe-key-value-store --name kuutti-prod-origin-proof --query KeyValueStore.ARN --output text)
  diff <(aws cloudfront-keyvaluestore get-key --kvs-arn "$arn" --key origin-secret --query Value --output text | shasum -a 256) \
       <(aws ssm get-parameter --name /kuutti/prod/origin-secret --with-decryption --query Parameter.Value --output text | shasum -a 256) && echo same
  ```

- Redeploy production once, so the running API holds the secret while it is still on `traefik`.
- At the cutover tag, approve its infra apply first. Before approving its deploy, `curl -s https://api.kuutti.app/health` must say `"trustedProxy":"traefik","originProof":"valid"`: the API from before, now behind the new distribution, sees the proof. Only then approve the deploy, which boots in `cloudfront` mode.

**The edge's rate rule (#41, ADR-067).** `modules/media/edge.tf` puts one AWS WAF web ACL, `kuutti-<env>-edge`, in us-east-1 on the distribution, with one rate-based rule: an address past `edge_requests_per_five_minutes` requests in any five minutes (2,000 in both environments, the maintainer's number, in `envs/<env>/main.tf`) is answered 429 at the edge, in the API's envelope (`rate_limited`, `"requestId":"edge"`, `Retry-After: 300`), until its count is under the limit again. It counts everything the distribution sends to the box, the API, Dokploy and the ACME path, except two things named in `modules/media/edge.json`: a signed photo's path, in the one shape the API signs (a prefix would let `/media/../health` through, since CloudFront picks the behaviour on the normalised path and sends the raw one), and the two sign-in starts, which the API refuses itself with its redirect (ADR-026 §4). The address is the one CloudFront took the connection from. A request through somebody else's distribution never meets it. The web ACL keeps no log and no sampled request, only metrics, and the plan role is denied the rule's list of the addresses it refuses and the samples (`ci_plan_deny_data`). The maintainer applies the bootstrap before the rule first refuses anybody: before the merge, from the branch, or at the latest before staging's burst test. The IP set `kuutti-<env>-edge-unlimited` holds the addresses the rule does not count: empty, and given the load smoke's runner for the hour of a run by hand (`docs/runbooks/capacity.md`, Before a run, step 8); OpenTofu ignores what is in it. Its alarm, `kuutti-<env>-edge-rate-limited`, is the observability module's, in us-east-1. What each layer catches, the burst test that proves the rule and the alarms, and how to move a number: `docs/runbooks/abuse.md`. Production's web ACL comes with its distribution, at the cutover.

### The demo on staging (#141, ADR-018)

Staging holds no real person: its identities are Telia's test persons (#140) and the synthetic population. The personas' stories, the population and the reset are written from inside the API's container and nowhere else; each command refuses outside it (ADR-018 §3). Reach the container through a Session Manager session on the box (the API runs as Dokploy's `api` application; its container name starts with the application's), or through Dokploy's terminal for that application:

```sh
aws ssm start-session --target "$(tofu output -raw instance_id)"
sudo docker ps --format '{{.Names}}' | grep staging-api   # the task of the api service, staging-api-<id>.1.<task>
sudo docker exec -it <container> node dist/demo-assets.js   # the photos release, public, over HTTPS; again after every deploy
sudo docker exec -it <container> node dist/demo-stories.js
sudo docker exec -it <container> node dist/demo-population.js --env staging --photos   # with the cast (#560), before the reset, which gives the members their likes and chats
sudo docker exec -it <container> node dist/demo-reset.js --env staging
```

The picture cache is the container's own (`/home/node/.cache`), so a deploy empties it: `demo-assets.js` runs again on every new container before the first stories, population or reset, which otherwise refuse and say so. The stories register the fixed personas as a registration would and give the histories, then their conversations, through the API's own service functions; a persona's first login at its test bank (`docs/vendors/telia.md` 1.4) then resumes the account. Run again, the stories change nothing. The population writes the one-pond population and counts the counter anew; `--remove` takes it away. The reset returns the personas to never-registered through the erasure path and gives the stories again (`--bare` for none). None of the three takes a database address or a key: they read staging's parameters as the API does, and a value given by hand is refused. A person without a home is in nobody's pool (ADR-061 §1), so the deploy that brings the home step needs the reset and the population run again, or everybody on staging reads as having no home.

**The reset from GitHub (#613, ADR-018 §8).** `demo-reset.yml` does the first and the last line of the block above for you, every night at 02:17 Helsinki time (#560) and whenever it is started: Actions, Demo reset, Run workflow, from `main`, or `gh workflow run demo-reset.yml`. Each run also undoes what testers did on the personas since the last. It sends the Run Command document `kuutti-staging-demo-reset` (`modules/compute`, declared by `envs/staging` alone with `demo_reset = true`) to the box through the plan role, which the bootstrap allows to send exactly that document to exactly that box (policy `demo-reset`; applied by the maintainer, as every bootstrap change is, and until then the run fails on AccessDenied). The document finds the `api` task, runs `demo-assets.js` and then `demo-reset.js --env staging`, and the run's log and step summary carry the reset's lines. The run is red when not everybody was reset: exit 2 names the personas it spared (a persona with a staff role or a line in the audit log is never reset, ADR-014 §12, so staff on staging sign in as a test person of the bed outside the twenty-five), exit 3 says no `api` container runs; GitHub mails a red scheduled run to whoever last changed its cron line. The stories and the population stay by hand: after a new version of a wording the reset gives the population the consents of the new one (ADR-014 §12), so the population is not written again for it.

### Photo moderation (#49, ADR-006)

The instance role may call `rekognition:DetectModerationLabels`, `rekognition:DetectFaces` and `rekognition:DetectLabels` (`modules/compute`, statement `RekognitionDetect`), the parameter `moderation=rekognition` under `/kuutti/<env>/` switches the API's automatic check on, and the observability module counts the calls from the `photo moderated` log lines (`RekognitionCalls` in the `Kuutti/<env>` namespace). Without the parameter every photo goes to the human queue (and tip signals stay empty).

Staff are identities with a role (rules/admin.md): the person signs in once through the bank, on the panel (refused, since there is no role yet, but the login is recorded, #202) or in the app; a person the database has never seen signs in to the app once first, since the panel creates nothing (ADR-006 §5). The maintainer then grants the role to the identity at the top of `recent`, from a machine that reaches the database (the Session Manager tunnel of `db-app-role.sh`). The API never logs a `hetu_hmac`; `recent` lists the last five bank logins by it, the app's and the panel's, newest first, with the time of each: check that the top one's is that sign-in's before granting.

```sh
export DATABASE_URL="postgres://kuutti_app:...@127.0.0.1:15432/kuutti?uselibpqcompat=true&sslmode=verify-ca&sslrootcert=$PWD/apps/api/certs/rds-eu-central-1-bundle.pem"
pnpm --filter @kuutti/db moderator -- recent
pnpm --filter @kuutti/db moderator -- grant <hetu_hmac> moderator --by "Nikolai"
pnpm --filter @kuutti/db moderator -- list
pnpm --filter @kuutti/db moderator -- revoke <hetu_hmac>
```

The parameters are there because RDS refuses a connection without TLS (`rds.force_ssl`) and, through the tunnel, the host is `127.0.0.1`, a name the server's certificate does not carry. `verify-ca` checks the certificate against the RDS roots bundled with the API and leaves the name out; `uselibpqcompat=true` makes pg read the mode as libpq does, since pg alone treats `verify-ca` as `verify-full` and refuses the connection. `sslrootcert` is absolute because pnpm runs the command from `packages/db`: export the variable from the repository's root.

Revoking ends the person's admin sessions at once. The panel signs in at `/admin/auth/start` and returns to `ADMIN_APP_URL`, which must also be on the CORS allowlist: both are parameters of the environment (`admin_app_url`, `cors_allowed_origins` in `envs/<env>/variables.tf` → `admin-app-url`, `cors-allowed-origins`). On staging the login returns to the hosted panel, `https://admin.staging.kuutti.app`, and the allowlist is that origin alone (Admin panel, below; ADR-025 §10); a developer's panel at `http://localhost:5173` talks to their own API (`pnpm env:up`), since the bank sends a staging login back to the hosted panel. Production defaults to `https://admin.kuutti.app`, which must exist before the first release (#25; the API refuses a non-https value there at boot).

The audit table's role boundary (ADR-006, security checklist line 67) is not a migration: migrations run as `kuutti_app`, and Postgres lets an owner hand a table only to a role it could `SET ROLE` into. After the first deploy that created `audit_log`, run

```sh
infra/scripts/db-audit-owner.sh staging
```

which moves the table, its trigger function and its prune to `kuutti_audit` and leaves `kuutti_app` with SELECT and INSERT on the table and EXECUTE on the prune, `audit_log_prune()`: the night's one way to delete a row, and only a row past five years (#714, ADR-076). The API logs `audit boundary` at boot with `enforced: true|false` and warns on staging and production until it is true; `packages/db/src/audit-owner.test.ts` runs the same SQL as a non-superuser in the master role's position on a fresh database.

The owner script first holds the table and its two functions to the shape the migrations leave (ADR-076 §6): while `release` had them in `kuutti_app`'s hands, a trigger, a rule, a policy, an index, a function's body or settings could have been added, and each would run in `kuutti_audit`'s hands at the night's prune. If anything differs, it stops with `audit_log is not as the migrations left it`, hands nothing over and prints the shape it found; the boot keeps warning. Compare that shape with a fresh database's, which `packages/db/src/audit-owner.test.ts` builds (or `pnpm env:up`'s, read with the script's first block as the local superuser), drop what was added, and run the script again. Treat an addition nobody made as an incident (`docs/runbooks/incident.md`). It then takes every grant on the table, its columns and both functions from everybody but the owner and grants `kuutti_app` SELECT, INSERT and EXECUTE on the prune alone, since what `release` let `kuutti_app` grant would otherwise outlast it, and both scripts name nothing outside the catalog in the master's session: `kuutti_app` owns the database, so it can set every session's search path there.

A later migration that touches `audit_log` or one of its two functions would fail as `kuutti_app`, and with it the boot, with the migrations before it applied (ADR-075). The sequence for such a change is: `db-audit-owner.sh <env> release` (ownership back to `kuutti_app`), deploy, `db-audit-owner.sh <env>` again. The pull request that carries the migration says so in its body, and writes the new shape's hash into `db-audit-owner.sql`, which the owner test refuses until it does. Migration 0014, which made the prune, is one (#714).

### Mail (#385, ADR-043)

Kuutti sends one kind of message, the code that confirms the optional e-mail address, from `noreply@kuutti.app` through SES (ADR-043 §1, §5). That address is an alias at the association's Google Workspace, so a reply reaches a person; the alarms mail `admin@kuutti.app`, a Workspace mailbox as well (`bootstrap/dns.tf`, #450). Three pieces, each in code:

- **The identity**, `bootstrap/mail.tf`, since it belongs to the domain and to no environment: `kuutti.app` as an SES identity in eu-central-1, the region the API's SES client uses (`S3_REGION`); Easy DKIM with 2048-bit keys that SES holds, signing every message as `d=kuutti.app`, through three CNAMEs `<token>._domainkey`; the custom MAIL FROM `mail.kuutti.app`, an MX to `feedback-smtp.eu-central-1.amazonses.com` and the SPF `v=spf1 include:amazonses.com -all`, where SES refuses to send while it cannot see that MX rather than fall back to `amazonses.com`; and the account's suppression list for bounces and complaints. The root's MX and SPF are the Workspace's, which SES does not need: its envelope is `mail.kuutti.app`. The reject DMARC holds for both senders (`bootstrap/dns.tf`), since each signs as `d=kuutti.app`, which aligns under `adkim=s`.
- **The permission**, `modules/compute`, statement `SesSendAsNoreply`: `ses:SendEmail` on the identities of `mail_domains` alone, with `ses:FromAddress` equal to `noreply@` of one of them; on staging, also every recipient within its testers (`ses:Recipients`, Staging's testers, below). Since #703 the list is both of the hosts' domains (ADR-072), so the API's `MAIL_FROM` can move to `noreply@kumpa.fi` with a parameter.
- **The switch**, the parameter `mail=ses` under `/kuutti/<env>/`, which the API reads as `MAIL` (ADR-043 §4). Without it a deployed API sends nothing and the code route answers 503 `mail_unavailable`.

`kumpa.fi` is a second identity of the same shape in `bootstrap/mail.tf` (#703, ADR-072): Easy DKIM as `d=kumpa.fi`, the MAIL FROM `mail.kumpa.fi` with its MX and SPF, in the `kumpa.fi` zone. Nothing sends through it until `MAIL_FROM` says `Kumpa <noreply@kumpa.fi>`, which waits for the maintainer's Workspace alias of that address, so that a reply reaches a person.

Staging and production are one account in one region, so they share the identities, the suppression list and the sandbox: production access is granted per account and region, and staging leaves the sandbox with production. SES bills 0.10 USD a thousand messages; the codes are a few a day.

In this order, maintainer only:

1. **The bootstrap.** CI never applies it, since it owns the CI roles. The plan adds the identity, its MAIL FROM, the suppression attributes and five records. After #450 it also moves the root's MX and TXT to `root_mx` and `root_txt`, imports Google's DKIM key (`google_dkim`) and adds the CAA's `iodef`, all without changing a mail record. Read it whole first: it may also hold other changes merged since the last apply.

   ```sh
   cd infra/bootstrap
   tofu plan
   tofu apply
   ```

2. **Verification.** SES looks for the DKIM records and the MX by itself, usually within minutes; AWS gives it up to 72 hours. Ready when this prints `True SUCCESS SUCCESS`:

   ```sh
   aws sesv2 get-email-identity --email-identity kuutti.app \
     --query '[VerifiedForSendingStatus, DkimAttributes.Status, MailFromAttributes.MailFromDomainStatus]' --output text
   ```

3. **The environments.** Merging applies `envs/staging` (the statement and the parameter), and the deploy after it reads `MAIL=ses` at boot; production follows at its next release tag. A send before step 2 is done answers 503 `mail_unavailable`, writes nothing, and logs `email code not sent` with the SDK's error name: `MessageRejected` while the domain is unverified, `MailFromDomainNotVerifiedException` while its MAIL FROM is.

**The sandbox.** Until AWS grants production access, SES delivers only to verified identities (an address, or any address of a verified domain), at most 200 messages a day and one a second; a code for anybody else is refused (`MessageRejected`) and answered 503. To try it on staging, list an address of your own in `MAIL_TESTERS` (Staging's testers, below) and verify it for the while. It is a personal address, so it never enters the code; the identity is made and removed from your own session:

```sh
aws sesv2 create-email-identity --email-identity <your address>   # SES mails a link: follow it
aws sesv2 delete-email-identity --email-identity <your address>   # when done
```

Then give the address in the app on staging and type the code. The message's `Authentication-Results` header shows `dkim=pass header.d=kuutti.app`, `spf=pass smtp.mailfrom=mail.kuutti.app` and `dmarc=pass`. In the sandbox SES can also check the sender's permission against the recipient's identity, which `SesSendAsNoreply` does not name: if the log line says `AccessDeniedException` although the address is verified and listed, that is the cause, and the identity's mail is proved from your own session instead until production access:

```sh
aws sesv2 send-email --from-email-address noreply@kuutti.app --destination ToAddresses=<your address> \
  --content 'Simple={Subject={Data=kuutti-mail-check},Body={Text={Data=delivery-check}}}'
```

**The suppression list** keeps every address that bounced or complained, for staging and production alike, Kuutti's own included: SES then accepts each message to it and drops it, while the API logs `email code sent` and nothing arrives. A code sent to an alias before the alias exists does that (2026-10-25). Once the address receives again, take it off:

```sh
aws sesv2 list-suppressed-destinations
aws sesv2 delete-suppressed-destination --email-address <address>
```

**Staging's testers.** Every account on staging is one of Telia's test persons, whose credentials are published (`docs/vendors/telia.md`), so anybody could have staging send codes to addresses of their choosing, and their complaints would count against the reputation and the suppression list production shares. Staging's role therefore mails only the addresses of its variable `mail_recipients` (ADR-043 §6), which CI fills from the repository variable `MAIL_TESTERS`, a JSON list; a pattern such as `*@example.fi` takes a whole domain. Unset, the list is `noreply@kuutti.app` and `noreply@kumpa.fi`, the senders (ADR-072): staging mails those addresses only, and a code asked for any other is answered 503 `mail_unavailable` (the log line says `AccessDeniedException`). Since 2026-10-25 the list is `["*@kuutti.app"]` (ADR-043 Open 7), which shows no tester's address; its ceiling is that anybody on staging can ask for codes to made-up addresses of the domain, whose bounces count against the reputation and the suppression list production shares (#196). To let testers in, set the list, then apply staging by re-running `main`'s latest infra run (GitHub re-runs a run for 30 days; past that, the next merge under `infra/` applies it):

```sh
gh variable set MAIL_TESTERS --body '["you@example.fi", "*@example.fi"]'
gh run rerun "$(gh run list --workflow infra.yml --branch main --event push --limit 1 --json databaseId --jq '.[0].databaseId')"
```

It is a repository variable, not the `staging` environment's, because the plan job has no environment and must read the list the apply reads. IAM compares the addresses case for case, so list each as its tester types it in the app. The list is not secret: the repository is public, the plan and apply steps' logs show it, and so does a pull request's plan comment whenever the role's policy changes, so list only addresses their owners agree to show, or a pattern. A shorter list and the same re-run take a tester out; `gh variable delete MAIL_TESTERS` and the re-run close staging again. Before asking AWS for production access, read the list back (`gh variable get MAIL_TESTERS`): out of the sandbox, it is what keeps staging closed.

**Production access**, once for the account and region, before the first release: the maintainer's request, which AWS reviews, usually within a day, and may ask more about in the support case it opens.

```sh
aws sesv2 put-account-details --production-access-enabled --mail-type TRANSACTIONAL \
  --website-url https://kuutti.app --contact-language EN \
  --additional-contact-email-addresses <project alias> \
  --use-case-description '<the answers below>'
aws sesv2 get-account --query '[ProductionAccessEnabled, SendQuota]'   # once granted: true, and a quota above 200 a day
```

What AWS asks, and what is true here (ADR-043 Open 5): what is sent (one plain-text message with a six-digit code, when a person asks to confirm the address they typed in the app; at most `email_codes_per_day`, five, a Finnish day per account; to a confirmed address also an announcement to everybody that two admins approved, while its person's switch for it is on, and the statement of a sanction staff applied to its account, ADR-068 §5 and ADR-073 §4); how the addresses are collected (each person types their own, optionally; none is bought, and none is a login); how bounces and complaints are handled (SES's account-level suppression list records every hard bounce and complaint and delivers nothing more to that address, `bootstrap/mail.tf`; #196 adds the events and Kuutti's own list); how a person stops it (removing the address in the app; announcements by their switch in Settings, or by the one-click Unsubscribe every announcement e-mail carries in its headers, RFC 8058, #196; a sanction's statement is about the person's own account and goes whatever the switches say; an unconfirmed address receives nothing but its confirmation); and the volume, a few messages a day, and on the rare day of an announcement one to every confirmed address.

Staging's personas have no address and stay unconfirmed (ADR-043 §6): one-time addresses under `kuutti.app` would need SES receiving, an MX and a receipt rule, to read their codes, for one card on the demo.

### Push (#102, ADR-055)

The API sends the app's pushes to Expo's push service over HTTPS (`apps/api/src/lib/push.ts`), which hands them to Apple and Google; nothing of AWS is added, and the box already reaches the internet as it does for Telia and Sentry. Two pieces here:

- **The switch**, the parameter `push=expo` under `/kuutti/<env>/`, which the API reads as `PUSH` (ADR-055 §8). Without it a deployed API sends nothing. Staging has it. Production gets it together with its access token.
- **The access token**, once the maintainer switches EAS's enhanced push security on (`docs/vendors/expo.md`, steps 3 and 4): the token of an Expo robot made for this alone, never CI's, as a secret, below, read as `EXPO_ACCESS_TOKEN`. Put it in both environments and restart their APIs before the switch, or every push is refused `UNAUTHORIZED`:

```sh
aws ssm put-parameter --name /kuutti/<env>/expo-access-token --type SecureString \
  --value file:///Volumes/<offline-medium>/kuutti-expo-access-token.txt
```

Apple's APNs key and Google's FCM key live in EAS, not here (`eas credentials`).

### Admin panel (#313, ADR-025)

`infra/modules/admin`, composed by each environment: the moderators' panel as static files at `https://admin.staging.kuutti.app` and, in production, `https://admin.kuutti.app`. The module creates a private bucket `kuutti-admin-<env>-<account>` (public access blocked, bucket owner enforced, SSE-S3, no versioning since every object is the build of a commit; incomplete uploads go after a day) that only the distribution reads, through origin access control; the distribution with its ACM certificate in us-east-1 and the A and AAAA alias records; the managed `CachingOptimized` policy; and a response-headers policy on every behaviour: a CSP of `default-src 'none'` whose `connect-src` is the API's origin alone, `img-src` `'self'` and the API's origin (the signed photo URLs, ADR-005), `script-src`, `style-src` and `font-src` `'self'` (Saiga's faces under `fonts/`, which the maintainer uploads by hand and the deploy's sync leaves alone, ADR-052), and `worker-src`, `base-uri`, `form-action` and `frame-ancestors` `'none'`, with HSTS, `nosniff`, `no-referrer`, `X-Frame-Options: DENY`, `Permissions-Policy`, COOP and CORP, and `X-Robots-Tag: noindex, nofollow` (the whole list is ADR-025 §3). The bucket answers 403 for a key it does not have, because CloudFront may not list it, and the distribution turns 403 and 404 into `/index.html` with 200, so `/accounts/<id>` loads the panel and its router finds the page (#302). There is no access log: the API's log has every staff request with the account and the request id, and a log of the host would add staff members' IP addresses and nothing a moderator does (ADR-025 §9). Each environment's `admin-app-url` is its address and its `cors-allowed-origins` that origin alone (ADR-025 §10).

CI writes the bucket, but for Saiga's faces under `fonts/`, which the maintainer uploads by hand since no runner ever has them (ADR-052); the deploy's sync leaves `fonts/` alone. `admin-deploy.yml`, which `build.yml` calls after each deploy, builds the panel against the environment's API and syncs it to the root as `kuutti-ci-apply` from that environment, `index.html` with `Cache-Control: no-cache` and the hashed assets as immutable, then invalidates `/*`. A pull request's panel is built and tested and goes nowhere (ADR-070).

The first apply on staging, once, by the maintainer, in this order (ADR-025, Consequences):

1. **The environment.** Merging applies `envs/staging` through `infra.yml`, as for every module: the bucket, the certificate (validated by a record in the zone, a few minutes), the distribution (about ten minutes), the alias records, and the two parameters. From here until step 3, a staff login on staging lands on an empty host.
2. **GitHub variables**, from the environment's outputs (`pnpm aws:login` first). The panel's jobs do nothing until they are set:

   ```sh
   cd infra/envs/staging
   tofu init
   gh variable set ADMIN_URL --env staging --body "$(tofu output -raw admin_url)"
   gh variable set ADMIN_BUCKET --env staging --body "$(tofu output -raw admin_bucket)"
   gh variable set ADMIN_DISTRIBUTION_ID --env staging --body "$(tofu output -raw admin_distribution_id)"
   gh variable list --env staging
   ```

3. **The first build.** Re-run `main`'s latest `build.yml` run, or merge anything: its panel jobs build and upload the panel, and its deploy boots the API again, which reads `admin-app-url` and `cors-allowed-origins` only at boot. A re-run is needed even when the merge's own deploy came after the apply, since its panel jobs found no variables.

   ```sh
   gh run rerun "$(gh run list --workflow build.yml --branch main --event push --limit 1 --json databaseId --jq '.[0].databaseId')"
   ```

4. **Saiga** (ADR-052), from a laptop with the typeface (`pnpm fonts`) and the AWS session of step 2. Again after a new release of Saiga, and if the bucket is ever made anew; until then the panel is in the system font.

   ```sh
   pnpm fonts -- --upload "$(cd infra/envs/staging && tofu output -raw admin_bucket)"
   curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "$(cd infra/envs/staging && tofu output -raw admin_url)/fonts/saiga-1.002/Saiga-Regular.woff2"   # 200 font/woff2
   ```

Done when (the issue's list): the panel at its address signs in through Telia's test bed as an identity that holds a role (Photo moderation, above) and shows the queues; the headers, a deep path and the API's CORS answer as below.

```sh
A=https://admin.staging.kuutti.app
curl -sI "$A/" | grep -i -E '^HTTP|^content-security-policy|^strict-transport-security|^x-frame-options|^x-robots-tag|^cache-control'
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "$A/accounts/00000000-0000-0000-0000-000000000000"   # 200 text/html: the panel, not an S3 error
for o in "$A" https://example.com http://localhost:5173; do
  printf '%s: ' "$o"
  curl -s -o /dev/null -D - -X OPTIONS -H "Origin: $o" -H 'Access-Control-Request-Method: GET' https://api.staging.kuutti.app/health \
    | tr -d '\r' | grep -i '^access-control-allow-origin:' || echo refused
done
```

The first origin is answered with itself, the other two are refused.

**Production's panel** (#25). The next `v*` tag's apply creates the host on `admin.kuutti.app`. Then, once, by the maintainer:

1. **GitHub variables**, from production's outputs (`pnpm aws:login` first):

   ```sh
   cd infra/envs/prod
   tofu init
   gh variable set ADMIN_URL --env prod --body "$(tofu output -raw admin_url)"
   gh variable set ADMIN_BUCKET --env prod --body "$(tofu output -raw admin_bucket)"
   gh variable set ADMIN_DISTRIBUTION_ID --env prod --body "$(tofu output -raw admin_distribution_id)"
   gh variable list --env prod
   ```

2. **The first build.** At a release `build.yml` calls `admin-deploy.yml` after `deploy prod`. A rehearsal tag stops at the release gate before that (ADR-049 §2), so start it by hand from the tag and approve its two jobs. `prod` admits `v*` tags alone, so a run from `main` is refused.

   ```sh
   gh workflow run admin-deploy.yml --ref "<the tag>" -f environment=prod
   ```

3. **Saiga**, as in step 4 above, with production's bucket and address.

Done when that run's checks are green: the headers, a deep path, `licenses.txt` and the API's CORS. Nobody can sign in to production's panel until production has bank identification (ADR-049).

### Observability (#11)

`infra/modules/observability`, composed by each environment: an SNS topic `kuutti-<env>-alerts` in eu-central-1, alarms for the instance status check, the instance and RDS CPU credit balances, the box's free memory (#77, The box's headroom below), RDS free storage, the API's 5xx rate (a metric filter on `/kuutti/<env>/api`), a failed nightly job, a day of many bank identifications (#471: `bank_identifications_per_day`, set by each environment, 50 in production, where Telia bills each, and 100 on staging's free test bed), the API's refusals for its limits (#41: `refusals_per_five_minutes`, 100: 429s on the request line and `sign-in refused` lines) and, once the distribution exists, the edge's refusals in us-east-1 (ADR-067), and five saved Logs Insights queries. The subscriber is the repository variable `ALERT_EMAIL` (`gh variable set ALERT_EMAIL --body <project alias>`), which CI hands to OpenTofu as `TF_VAR_alert_email`; confirm the subscription from that mailbox after the first apply (`aws sns list-subscriptions-by-topic --topic-arn <alerts_topic_arn>` shows `PendingConfirmation` until the link in AWS's mail is followed), then run the delivery test in `docs/runbooks/alerts.md`. Without the variable the topic exists with no subscriber. About 4 USD a month per environment (the module's header has the sum).

Logs reach that group through the Docker daemon's default driver, which user data sets to `awslogs` before Dokploy's installer starts a single container (`modules/compute/templates/user_data.sh.tpl`): every container on the box logs to `/kuutti/<env>/api`, one stream per container name, Dokploy's own included. Nothing to set per application. The instance role allows the stream calls; the group has 30-day retention.

Sentry (TD-19, the one vendor besides AWS, Expo, GitHub and Telia), maintainer once; the click-by-click version with the two ways to prove it is `docs/runbooks/sentry-setup.md`: an organisation `kuutti-ry` (`kuutti-fi` until October 2026) in the EU data region (`https://de.sentry.io`), projects `api` and `mobile`. The DSNs are public by design: `aws ssm put-parameter --name /kuutti/<env>/sentry-dsn --type String --value <api dsn>` per environment (the API reads it as `SENTRY_DSN`; unset keeps the SDK off), and `eas env:create --environment preview --name EXPO_PUBLIC_SENTRY_DSN --value <mobile dsn> --visibility plaintext` (and `production`). The source-map auth token is a secret in exactly three places, never at repository level: `gh secret set SENTRY_AUTH_TOKEN --env staging` and `--env prod` for the updates `deploy.yml` publishes, and `eas env:create --environment preview --name SENTRY_AUTH_TOKEN --visibility secret` (and `production`) for native builds. The token's scope is `project:releases` and `org:read`, nothing more. A token carries the organisation's slug it was made under, so renaming the organisation means a new token in all three (the runbook, section 4).

### Cost

TD-4 budgets 50 EUR a month. One environment is roughly 30 EUR (instance, database, address, storage); with production's larger database both together come to about 90 to 95 USD at list price, before VAT. Decision (2026-09-14): staging is applied now, prod when there is a first release; raising `monthly_budget_usd` in the bootstrap is the deliberate step that goes with it. Changed on 2026-10-24 (ADR-049): production is applied before the first release, as a rehearsal of #25 without bank identification, and stays up; the budget is 150 USD (110 until 2026-10-31), counted before credits, so the association's AWS credit does not hide what the two environments use. Production's `t4g.medium` (ADR-046) adds about 14 USD, so both together come to about 105 to 110 USD, and the credit of 1,000 USD lasts some nine months at that rate. Each environment's distribution carries a web ACL from its cutover, about 6 USD a month (#41, ADR-067): with production's, both environments come to about 117 to 122 USD at list price, around the budget's 80 % alert at 120. The panel's host adds about nothing (ADR-025): CloudFront's free tier covers 1 TB out, 10 million requests and 2 million function invocations a month, the certificate and the alias queries are free, and the bucket holds a few megabytes.

### Two names (#703, ADR-072)

Every host has a second name under `kumpa.fi`, the app's name, beside its `kuutti.app` one, until no installed build calls `kuutti.app`: `api`, `origin.api`, `dokploy` and `admin` (staging's under `staging.`). Each environment's `extra_domains` (`["kumpa.fi"]`) gives them: `dns.tf` writes their records in that zone, the API's and the panel's distributions carry them as aliases, and each certificate names both, every name validated in its own zone. `domain` stays `kuutti.app` and is still the one the configuration names: the API's parameters, the bank's callback, the panel's API origin and its CSP, the outputs and the GitHub variables. With `media_enabled`, the second `api` and `dokploy` are the distribution's and the second `origin.api` the box's, though the distribution still connects by `origin.api.<env>.kuutti.app`; without it, as in production before its cutover, the second `api` and `dokploy` point at the Elastic IP. `cors-allowed-origins` holds both of the panel's origins, and the box may send mail as `noreply@` of both domains (Mail, above).

In this order, maintainer only:

1. **The bootstrap**, by hand (Bootstrap, run once): the `kumpa.fi` SES identity, its MAIL FROM and five records (Mail, above), and `kumpa_caa` changed in place to admit `letsencrypt.org`, which Traefik needs for the names below. Then `aws sesv2 get-email-identity --email-identity kumpa.fi` as in Mail, step 2.
2. **Staging**, by the merge (`infra.yml`): the records, the two certificates replaced by ones that name both (created before the old ones go), both distributions' aliases, the instance role's statement and `cors-allowed-origins`. The API reads the origins at boot, so redeploy it once in Dokploy after the apply.
3. **Dokploy**, `dokploy-setup.sh staging` again, as in After the first apply, step 2: the application gets `api.staging.kumpa.fi`, and the pin is written again with a pair of routers for each name. Traefik asks Let's Encrypt for the new names at once, by HTTP-01 through the distribution's ACME behaviour, so the apply comes first.
4. **Checks**, from anywhere:

   ```sh
   curl -fsS https://api.staging.kumpa.fi/health                      # "originProof":"valid", as through kuutti.app
   curl -fsS -o /dev/null -D - https://admin.staging.kumpa.fi/ | grep -i '^content-security-policy'   # connect-src https://api.staging.kuutti.app
   curl -fsS -o /dev/null -D - -X OPTIONS -H 'Origin: https://admin.staging.kumpa.fi' \
     -H 'Access-Control-Request-Method: GET' https://api.staging.kuutti.app/health | grep -i '^access-control-allow-origin'
   curl -fsS -o /dev/null -w '%{http_code}\n' https://dokploy.staging.kumpa.fi/   # Dokploy's sign-in page
   ```

5. **Production** at its next release tag (`infra-prod.yml`), then `dokploy-setup.sh prod`. Its 443 is open until its cutover, so Traefik gets the certificates of `api.kumpa.fi` and `dokploy.kumpa.fi` straight from the box's port 80.

What waits (ADR-072 §7 and §8): the bank's callback once Telia has registered the `kumpa.fi` ones, `MAIL_FROM` once the Workspace alias exists, the builds' and the GitHub environments' addresses, the invitation link; then, once no installed build calls `kuutti.app`, the `kuutti.app` hosts go.

### After the first apply, once per environment

1. **Application role.** RDS is private, so the script tunnels through the box with Session Manager (`brew install --cask session-manager-plugin` once). It creates `kuutti_app`, makes it the owner of the `kuutti` database so migrations can run, and stores its password as `/kuutti/<env>/db-app-password`. The master password stays inside the script's process.

   ```sh
   infra/scripts/db-app-role.sh staging
   ```

2. **Dokploy.** The first boot installs Docker and Dokploy `v0.30.6` (variable `dokploy_version`) from the installer vendored at `modules/compute/installer/` and embedded in user data, verified by hash on the box. Port 3000 is never opened; reach the UI through a port forward, create the admin account, and keep its credentials in the password manager. Until that account exists whoever opens the UI becomes its owner, so nothing on 80 or 443 reaches Dokploy before then: first boot writes Dokploy's `dokploy.yml` with the service alone, which keeps Dokploy from adding its default `dokploy.docker.localhost` router, and no router of its own (#437, ADR-048). A fresh box answers these with Traefik's 404 (or not at all, `000`, while Traefik is still starting) until `dokploy-setup.sh` has run: the first from anywhere, the second from anywhere while the environment's 443 is open, the third on the box where it admits CloudFront alone:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: dokploy.docker.localhost' "http://$(tofu output -raw public_ip)/"
   curl -sk -o /dev/null -w '%{http_code}\n' -H 'Host: dokploy.kuutti.app' "https://$(tofu output -raw public_ip)/"   # while the environment's 443 is open
   # Where cloudfront_only_ingress is on (staging since #198), 443 answers CloudFront alone: ask on the box, in a Session Manager session.
   curl -sk -o /dev/null -w '%{http_code}\n' -H 'Host: dokploy.staging.kuutti.app' https://127.0.0.1/
   ```

   The port forward:

   ```sh
   aws ssm start-session --target "$(tofu output -raw instance_id)" --document-name AWS-StartPortForwardingSession --parameters portNumber=3000,localPortNumber=3000
   ```

   In the UI, only what creates credentials: the admin account, its two-factor authentication (Settings, Profile) and an API key from the same page. Everything else is `infra/scripts/dokploy-setup.sh <env>`, run with `DOKPLOY_URL=http://localhost:3000`, the key exported as `DOKPLOY_TOKEN` (`read -rs DOKPLOY_TOKEN && export DOKPLOY_TOKEN`, so it is never on a command line) and `INSTANCE_ID` from `tofu output -raw instance_id`, which it requires and checks against the environment's box by its `Name` tag before it changes anything: one project named after the environment, one application `api` deployed from the GHCR image (#8), the domains `api.staging.kuutti.app` and `api.staging.kumpa.fi`, or `api.kuutti.app` and `api.kumpa.fi`, with Let's Encrypt through Traefik on container port 3000 (Two names, below), Dokploy's own domain, the priority routers that pin each name of `dokploy` and `api` to its owner (`00-control-plane.yml`, ADR-048; it stops before the deployment if Run Command cannot write them), and the first deployment. Run it again after a change; it updates what exists. The application environment it sets is exactly `NODE_ENV=production`, `APP_ENV=staging` (or `production`), `PORT=3000`; everything else comes from SSM through the instance role, never from Dokploy (the image itself sets `AWS_REGION` and `DB_SSL_ROOT_CERT`, so the SDK finds the region and pg verifies RDS with the bundled root certificates). Logs need no setting: user data makes `awslogs` the Docker daemon's default driver, so every container on the box, the API included, writes to `/kuutti/<env>/api` under a stream named after the container. DNS is code: `envs/<env>/dns.tf` points `api` and `dokploy` at the Elastic IP while `media_enabled` is off, and at the distribution once it is on, with `origin.api` at the Elastic IP (#198), so the names resolve minutes after the apply and Traefik can obtain its certificates.

3. **Deploy path.** `deploy.yml` calls Dokploy's API from GitHub, so the control plane must be reachable over HTTPS: Dokploy's own domain (`dokploy.staging.kuutti.app` or `dokploy.kuutti.app`, set by `dokploy-setup.sh`, else under Settings, Web Server) with Let's Encrypt; port 3000 stays closed, Traefik serves the UI and API on 443. Then, for each GitHub environment, three variables and one secret (`gh secret set` prompts for the value; never paste it into a command line; the setup script prints the exact commands with the application id):

   ```sh
   gh variable set DOKPLOY_URL --env staging --body https://dokploy.staging.kuutti.app
   gh variable set DOKPLOY_APPLICATION_ID --env staging --body <id from the application's URL in Dokploy>
   gh variable set API_URL --env staging --body https://api.staging.kuutti.app
   gh secret set DOKPLOY_TOKEN --env staging
   ```

   After the first image push, make the GHCR package public once (package settings, Danger zone, Change visibility) so the box pulls without a credential.

4. **Checks.** From the box (`aws ssm start-session --target <instance-id>`, shell `ssm-user`, `sudo -i` for root). Everything typed and printed in a session is streamed to `/kuutti/ssm-sessions`, so a secret must never be printed there; the forms below keep the value inside the shell:

   ```sh
   aws ssm get-parameter --name /kuutti/<other env>/db-host                     # must be refused
   PGPASSWORD="$(aws ssm get-parameter --name /kuutti/<env>/db-app-password --with-decryption --query Parameter.Value --output text)" \
     psql "host=$(aws ssm get-parameter --name /kuutti/<env>/db-host --query Parameter.Value --output text) dbname=kuutti user=kuutti_app sslmode=verify-full sslrootcert=/etc/kuutti/rds-ca.pem" -c 'select 1'
   ```

   From your machine: `aws iam get-role --role-name kuutti-api-<env> --query Role.PermissionsBoundary` shows the boundary.

### The box's headroom (#77, ADR-046)

Twice (2026-09-27, 2026-10-08) the box, 1.8 GB, ran out of memory with Dokploy, the API and previews on it, and the API went with it. One script, `modules/compute/templates/headroom.sh.tpl`, keeps that from happening again: a swap file with `vm.swappiness = 10` (`swap_mb`: 2 GB on staging, none in production, a `t4g.medium` so that swap never pages a hetu to the disk, rule 1), and the box's `MemAvailable` pushed to CloudWatch (`Kuutti/<env>/box`) every minute by a cron line, which the alarm `kuutti-<env>-memory-low` reads (`docs/runbooks/alerts.md`). No memory limit on Dokploy: Node inside it sizes its heap at half of one, and Dokploy crashed in a loop under 1 GiB (ADR-046 §2 and History).

A new box runs the script at first boot. A running box never sees an edit of user data, so it gets the same script from the Run Command document `kuutti-<env>-headroom`, which the maintainer sends after the apply that creates it, and again after a change of `swap_mb`. Until then the alarm says ALARM, since a box that has never pushed counts as breaching. A second run changes nothing; a swap file made by hand keeps its size, and its mode becomes 0600. From `infra/envs/<env>`, where `tofu output` has the state, with your own session (`pnpm aws:login`):

```sh
id="$(tofu output -raw instance_id)"
cid="$(aws ssm send-command --instance-ids "$id" --document-name "$(tofu output -raw headroom_document)" --query Command.CommandId --output text)"
aws ssm wait command-executed --command-id "$cid" --instance-id "$id"
aws ssm get-command-invocation --command-id "$cid" --instance-id "$id" --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
```

It prints the swap and where the metric goes, and fails, saying so, when the first push did not work. Staging's ran on 2026-10-24. Then #77's checks, staging only:

1. On the box: `free -m` shows 2 GB of swap.
2. The API keeps answering while Dokploy dies and is started again: seen for real on 2026-10-24, when Dokploy crashed every 25 seconds under the limit ADR-046 has since withdrawn and `/health` answered throughout.
3. The alarm. From your machine, `aws cloudwatch describe-alarms --alarm-names kuutti-staging-memory-low --query 'MetricAlarms[0].StateValue'` says `OK` a few minutes after the document ran. To see it fire, hold more memory than the box has available, for seven minutes, in a container of its own on the box, with no network, so the image never reaches the instance role, and keep every page of it written. Less does not fire it on a box with swap (tried on 2026-11-05, #77): a buffer written once is paged out within the minute and `MemAvailable` barely moves, and a buffer smaller than `MemAvailable`, even one kept written, leaves the kernel room to page everything else out and settle at 200 to 280 MB, just over the threshold. With `MemAvailable + 60` MB written twice a second, `MemAvailable` sat at 110 to 130 MB, the alarm said ALARM 5 min 37 s after the hold began and OK 1 min 35 s after it ended, and `/health` answered 200 throughout. That the box settles just over 200 MB while swap carries the load is open on #77: whether the threshold moves, or a second alarm reads swap in use (ADR-046).

   ```sh
   mb=$(awk '/^MemAvailable:/ { printf "%d", $2 / 1024 + 60 }' /proc/meminfo)
   docker run --rm --network none --name memory-alarm-test -e MB=$mb python:3.13-alpine python -c "import os, time; n = int(os.environ['MB']) * 1048576; b = bytearray(n); z = bytes(len(range(0, n, 4096))); end = time.time() + 420; [(b.__setitem__(slice(None, None, 4096), z), time.sleep(0.5)) for _ in iter(lambda: time.time() < end, False)]"
   ```

If Dokploy ever has to lose a memory limit again, `docker service update --limit-memory 0 dokploy` is the form to use: `docker service rollback` swaps to the previous settings, whichever they are.

### Backups and rebuilding the box

The box is stateless except for Dokploy's own configuration, the one manual island of ADR-001. A cron job at 02:17 UTC tars `/etc/dokploy` (Traefik configuration and certificates, application definitions) together with a dump of Dokploy's database and uploads it with SSE-KMS to `s3://kuutti-tfstate-<account>/dokploy-backup/<env>/`. The plan role can list the bucket but is denied `kms:Decrypt`, so it cannot read these objects. The box writes them and cannot read or list them: every container on the box holds its role, and a backup carries every certificate key on the box (ADR-054).

```sh
aws s3 ls s3://kuutti-tfstate-438298963814/dokploy-backup/staging/
```

Rebuild from scratch, tested once per the #7 checklist:

1. `tofu apply -replace=module.compute.aws_instance.api` in the environment. The Elastic IP moves with it; wait for `cloud-init status --wait` on the new box to report done (Dokploy is installed fresh, with the swap and the free-memory metric of the headroom script, The box's headroom above, and serves nothing on 80 or 443 until the backup brings its owner and its routers back, ADR-048).
2. Fetch the latest backup onto the new box. First make sure the object is the nightly job's: the listing above shows one object for that night, and `aws s3api list-object-versions --bucket kuutti-tfstate-<account> --prefix dokploy-backup/<env>/dokploy-<stamp>.tgz` shows one version of it, written at 02:17 UTC give or take a minute. Every container on the box holds the role that writes under the prefix (ADR-054), so a second object for a night, a second version of a stamp, or a stamp off the job's minute, is somebody else's object: take the previous night's. A write timed to the job's minute would pass this check; the signature ADR-054 puts off would catch that too, and until it exists the check is yours (the audit of #609, run 1, record 2). The instance role cannot read the backup (ADR-054), so from your machine, with your own session, presign it; S3 decrypts it for the link's signer: `aws s3 presign s3://kuutti-tfstate-<account>/dokploy-backup/<env>/dokploy-<stamp>.tgz --expires-in 300`. On the new box (`aws ssm start-session`, then `sudo -i`), paste it without echo: `read -rs url && curl -fsS -o /root/backup.tgz "$url"; unset url`. The link stops working after five minutes.
3. Still on the box: `docker service scale dokploy=0`, `tar -C / -xzf /root/backup.tgz etc/dokploy`, then the database into the fresh container (the dump holds only the `dokploy` database, so the container's generated password survives): `tar -C /root -xzf /root/backup.tgz dokploy-db.sql`, `c=$(docker ps -q --filter name=dokploy-postgres)`, `docker exec -i "$c" psql -v ON_ERROR_STOP=1 -1 -U dokploy -d dokploy < /root/dokploy-db.sql`, then `docker exec "$c" psql -U dokploy -d dokploy -tAc "select count(*) from member where role = 'owner'"`, which must print 1 or more, then turn two-factor sign-in off, since no code would pass it: `docker exec "$c" psql -v ON_ERROR_STOP=1 -U dokploy -d dokploy -c 'delete from two_factor; update "user" set two_factor_enabled = false'`, and only then `docker service scale dokploy=1`. A Dokploy started without its owner, behind the routers the backup brought back, would make the first visitor its owner (ADR-048). The two-factor secrets, like the applications' environments, are encrypted with Dokploy's auth secret, a Docker secret that the installer makes afresh on every box and the backup does not carry. The API keys are hashed without it and keep working; sessions are dropped.
4. Sign in to Dokploy with the owner's password and turn two-factor authentication on again at once (Settings, Profile); the new backup codes go to the password manager. At once, as the owner (`docs/runbooks/rotation.md` (9); Settings, Profile shows the signed-in user's keys alone), delete every API key the backup brought back and make the new ones, then set the secrets as that section says: the dump carries the keys as they were at 02:17, so a key deleted after it is back and valid, and so is its holder's deploy, until the new ones replace it (the audit of #609, run 1, record 4). Then run `dokploy-setup.sh <env>` with the new key (After the first apply, step 2): the application's environment comes back unreadable, and the script writes it again and deploys. Certificates come back with `/etc/dokploy/traefik`.

A newer AMI or an edited first-boot script never replaces a running box on its own (`ignore_changes`); rebuilding is always the explicit `-replace` above.

## Secrets

Secret parameters are not resources in this code: the AWS provider would store the decrypted value in state on every refresh, and `ignore_changes` only hides the diff. Create them once, out of band, and reference them by path in the instance-role policy. Reserved paths, `<env>` being `staging` or `prod`:

| path | read by | created in |
|---|---|---|
| `/kuutti/<env>/hetu-hmac-key` | API at boot; HMAC-SHA256 of the hetu (rules 1 and 2) | M2 |
| `/kuutti/<env>/telia-signing-key` | API; signs the request object and the `private_key_jwt` client assertion of the Telia exchange (docs/vendors/telia.md) | #32 |
| `/kuutti/<env>/telia-encryption-key` | API; decrypts the ID token Telia encrypts to us | #32 |
| `/kuutti/<env>/cloudfront-signing-key` | API; signs photo URLs (ADR-005); the public half is `envs/<env>/cloudfront-signing-key.pub.pem` in the repository | #48, at the media cutover |
| `/kuutti/<env>/db-app-password` | API; its own database role | #7 |
| `/kuutti/<env>/origin-secret` | API at boot; the proof of Kuutti's distribution, compared with the `x-kuutti-origin` that its CloudFront Function sets from the store `kuutti-<env>-origin-proof`, which holds the same value (ADR-066; `docs/runbooks/rotation.md` section 17) | #198, before the switch to `cloudfront` |
| `/kuutti/<env>/expo-access-token` | API at boot; authenticates its pushes to Expo once EAS's enhanced push security is on (`docs/vendors/expo.md`) | #102, before the switch |
| `/kuutti/ci-check/secret` | nothing; proves the plan role cannot decrypt | #6 |

All are `SecureString` under the default `aws/ssm` key. The plan role is denied `kms:Decrypt`, so it can list them but never read them.

The hetu HMAC key is never rotated (TD-1) and never leaves SSM except for one offline backup taken at creation. Generate it straight onto the offline medium so the value never sits in a shell history or a cloud drive, then load it:

```sh
openssl rand -hex 32 | tr -d '\n' > /Volumes/<offline-medium>/kuutti-prod-hetu-hmac-key.txt
aws ssm put-parameter --name /kuutti/prod/hetu-hmac-key --type SecureString \
  --value file:///Volumes/<offline-medium>/kuutti-prod-hetu-hmac-key.txt
```

`file://` makes the CLI read the value itself, so the key never appears in the shell history or in the argument list another process could list. It also stores the file byte for byte, newline included: `tr -d '\n'` keeps the parameter to the 64 digits (the API trims the value as well, since 2026-10-07, when the staging preview refused to boot on a key with a newline).

`<offline-medium>` is an encrypted volume whose passphrase the association holds separately. Eject it afterwards; the association keeps it, not the maintainer's desk drawer.

The two Telia keys are RSA, 3072 bits (Telia's minimum is 2048), one for signing (`sig`) and one for encryption (`enc`), generated onto the same offline medium by `scripts/telia-keys.sh`; the private halves go to SSM, the public halves to Telia as JWKs (`docs/vendors/telia.md`, section 2.1 of the guide). The `kid` of each JWK is the key's RFC 7638 thumbprint, nothing chosen: Telia names our `enc` key by it in every ID token's JWE header (guide 2.6.3) and the API computes the same value from the private key at boot (`keyIdOf`) and logs both kids under "bank identification", so what Telia registered and what the API decrypts with cannot disagree. Keep the registered kids in `docs/vendors/telia.md`.

```sh
infra/scripts/telia-keys.sh staging /Volumes/<offline-medium>        # both keys onto the medium, plus kuutti-staging-telia-jwks.json for Telia
infra/scripts/telia-keys.sh staging /Volumes/<offline-medium> --put  # the private halves into SSM, by file reference, never on a command line
```

The script refuses to overwrite a key and `put-parameter` runs without `--overwrite`: a Telia key is replaced by rotation (new pair, new JWKs to Telia, then `--overwrite` by hand, then a restart; `docs/runbooks/custody.md`), never in place.

`db-app-password` is created by `scripts/db-app-role.sh`; rotating it is `ALTER ROLE kuutti_app PASSWORD '…'` through the same tunnel, `put-parameter --overwrite`, and a restart of the API. The signing keys are not random bytes: the CloudFront key is an RSA key pair whose public half becomes a CloudFront public-key resource (ADR-005, above), and the two Telia keys are the RSA pairs `telia-keys.sh` generates. The RDS master password is not managed here at all: `manage_master_user_password = true` leaves it with AWS so it never enters state.

## The website

`kuutti.app` is served by Amplify Hosting from the site's own repository, `kuutti-ry/kumpa-app-site`: its `amplify.yml` is the build spec, its `customHttp.yml` the headers, and a push to its `main` deploys. The same site answers at `kumpa.fi`, a second custom domain of the app (2026-11-16), with `www.kumpa.fi` redirected to it; `kuutti.app` stays the home. The `kumpa.fi` zone was made by its registration and is adopted in `bootstrap/dns.tf` with Google Workspace's records, a reject DMARC and a CAA for Amazon's issuers and Let's Encrypt (the boxes serve names there too, Two names); Amplify's records there are this section's exception too. The placeholder page this repository served from `site/` until 2026-09-28 is gone.

The Amplify app (`kumpa-app-site`, eu-central-1) is the console-created exception of ADR-001: connecting Amplify to a repository is an installation of the Amplify GitHub App, a browser consent. The CLI connects an app only with a GitHub token (`create-app` or `update-app` with `--access-token`), and then adds a deploy key to the repository, which the organisation refuses: deploy keys are off in `kuutti-ry`, and a token kept in state is what the ADR forbids anyway. Creating it, once, in the Amplify console: *Create new app*, GitHub; on GitHub's page give the Amplify GitHub App access to `kumpa-app-site` (*Only select repositories*); repository `kuutti-ry/kumpa-app-site`, branch `main`, not a monorepo; the build settings are read from the repository's `amplify.yml`; under *Advanced settings* the environment variable `FONTS_TOKEN`, the site's own read-only token for Saiga (the site's decision 18; without it the site is built in Inter); *Save and deploy*. Then *Custom domains*, *Add domain*, `kuutti.app` and `kumpa.fi` from the Route 53 list, each with `www`: Amplify issues the certificate and writes the validation and alias records into the zone itself (10 to 30 minutes).

The console leaves three things to put right, from the CLI after `pnpm aws:login`, no token involved: it adds a catch-all rewrite (`/<*>` to `/index.html`, 404-200) that would answer every missing address with the home page, and the site has real pages and a 404 of its own; the redirects from `www` and the cost allocation tag are not set. The site needs one rule more. Its status panel reads `/status/health.json` on the site's own origin, the only one its content security policy lets it reach (`connect-src 'self'`), and a 200 rewrite to production's `https://api.kumpa.fi/health` has Amplify fetch the API's health and answer with it under both names (the site's README; set 2026-11-20). It stays that one exact path: the site's origin on the API's CORS allowlist would be answered on every route, and a wildcard would make the site a browser client of the product (rule 8). `--custom-rules` replaces every rule the app has, so it names all five: the two redirects from `www`, the two of the misspelling below, and the status rewrite.

```bash
APP=$(aws amplify list-apps --query "apps[?name=='kumpa-app-site'].appId" --output text)
aws amplify update-app --app-id "$APP" --custom-rules source=https://www.kuutti.app,target=https://kuutti.app,status=301 source=https://www.kumpa.fi,target=https://kumpa.fi,status=301 source=https://kunpa.fi,target=https://kumpa.fi,status=301 source=https://www.kunpa.fi,target=https://kumpa.fi,status=301 source=/status/health.json,target=https://api.kumpa.fi/health,status=200
aws amplify tag-resource --resource-arn "arn:aws:amplify:eu-central-1:$(aws sts get-caller-identity --query Account --output text):apps/$APP" --tags Project=kuutti,ManagedBy=console
aws amplify get-domain-association --app-id "$APP" --domain-name kuutti.app --query 'domainAssociation.[domainStatus,statusReason]' --output text
curl -sI https://kuutti.app/ | grep -i -E '^HTTP|content-security-policy'
for h in kumpa.fi kuutti.app; do curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "https://$h/status/health.json"; done
```

`kunpa.fi`, the misspelling with an n, is a third custom domain of the app and serves no page: over https, it and `www.kunpa.fi` answer a 301 to the same path and query on `kumpa.fi`, and over http first a 301 to https under the same name (#726). The name is registered at Zoner, not through Route 53, and Zoner's own forwarding answers on http alone: over https it presents a certificate for its own name, and a browser warns. So the bootstrap creates the name's zone (`bootstrap/dns.tf`), with records that say it has no mail, and Zoner's Nameserver page carries the zone's four name servers, entered by hand after the apply, since the .fi registry checks that they answer for the name:

```bash
(cd infra/bootstrap && tofu output kunpa_name_servers)
aws amplify create-domain-association --app-id "$APP" --domain-name kunpa.fi --sub-domain-settings prefix=,branchName=main prefix=www,branchName=main
aws amplify get-domain-association --app-id "$APP" --domain-name kunpa.fi --query 'domainAssociation.[domainStatus,statusReason]' --output text
for u in http://kunpa.fi https://kunpa.fi http://www.kunpa.fi https://www.kunpa.fi; do curl -sL -o /dev/null -w '%{num_redirects} %{url_effective}\n' "$u/legal/privacy/?x=1"; done
```

Run the `update-app` line above first, with the misspelling's two rules in it: an association made before its rules would serve the site itself under `kunpa.fi` until they exist. The association comes after the name servers, since the certificate is validated through the zone. The zone costs 0.50 USD a month. To take the name off the app: `delete-domain-association`, then at once the alias, `www` and validation records Amplify left in its zone, which no state holds and which would otherwise point at a distribution that is no longer the app's.

A domain is associated with one app at a time: moving it from another app means removing it there first, and some minutes without the site while the certificate is issued anew. To retire the app: `delete-app`, then the records it left in the zone.

An app does not follow a rename of its repository: GitHub still delivers the pushes and Amplify answers them, but builds nothing. When the site's repository was renamed `kumpa-app-site` on 2026-11-16 (#702), the first app, `kuutti-app-site` from 2026-09-28, was replaced the same day by this one, made as above, with its domains moved over and the old app deleted. A rename of the repository again means the same: a new app, then the domains, then `delete-app` on the old one.

## What is not here

Dokploy's own configuration (no provider exists; `user_data` installs it, its contents are backed up from `/etc/dokploy`), the registration of the domain itself (its zone and records are code), the Amplify Hosting app for the website (above), SES production access and any address verified to try mail in the sandbox (Mail, above), secret values, the EAS account side (the organisation and project, credentials, the robot token; `apps/mobile/README.md`), store setup, the Telia contract, and creation of the AWS account.
