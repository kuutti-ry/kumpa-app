# ADR-070: No pull-request previews

- Status: proposed (#705, on the maintainer's word of 2026-11-16 in chat; built as written here in the pull request for #705; the box emptied, `PREVIEWS_ENABLED` switched off and the environment `preview` deleted by the maintainer on 2026-11-16, before the merge; the applies ran by 2026-11-17, and the Functions, the parameter, the environment `preview-cleanup` and the variable went by 2026-11-18; the rest of #705's step 3 waits on the maintainer; accepting it is the maintainer's)
- Date: 2026-11-16
- Follows: the maintainer's word of 2026-11-16 in chat (nobody has used a preview once; remove them completely and clean up after them); TD-2 (free tiers and three previews: departed from here, see Context), TD-19 (one staging box with the previews on it: departed from here, see Context), ADR-018 (staging is the demo, its data invented); supersedes ADR-012 and ADR-053; amends ADR-004 §2 and §3, ADR-014 §1 and ADR-025 §4 to §8; issues #705, #9, #313, #448

## Context

From #9, #313 and #448, every pull request from this repository got its own copy of Kuutti, in four lanes, deployed by `preview.yml` and removed by `preview-cleanup.yml` (ADR-012):

- **API.** The image `build.yml` pushed as `:pr-<n>-<sha7>` ran on the staging box as the Dokploy application `api-pr-<n>` in the `previews` project. At boot it created, migrated and seeded `kuutti_pr_<n>` on staging's RDS instance as the role `kuutti_preview`, and it answered at `https://pr-<n>.preview.api.staging.kuutti.app` under one wildcard certificate obtained by DNS-01 (ADR-053).
- **Web.** The phone app's web export of the same commit, pointed at that API, on EAS Hosting as the alias `pr-<n>`.
- **Native.** An EAS Update on the branch `pr-<n>`, when the fingerprint or a native path differed from `main`'s.
- **Panel.** The moderation panel built under `/pr-<n>/` against the staging API and written to `pr-<n>/` of the staging panel's bucket (ADR-025 §6 to §8).

TD-2 counted three previews among the free tiers, and TD-19 put them on the one staging box. On 2026-11-16 the maintainer said that nobody had used a preview a single time, and that they go completely, with everything they left running or configured. Meanwhile they cost:

- up to three more API containers on the staging t4g.small, inside ADR-046's headroom;
- a pull request's unreviewed code running with the staging instance role, which reads every `/kuutti/staging/*` parameter (ADR-004 §3 made write access that trust);
- a cleanup run every ten minutes, a push to GHCR on every pull request and a `fingerprint-main` job on every push to `main`;
- resets by hand when a branch's migrations moved (PR #557, PR #429);
- a sweep that did not always sweep: on 2026-11-16 the staging instance still held twelve preview databases, from `kuutti_pr_261` to `kuutti_pr_701`, that cleanup runs had logged as dropped, most likely because the drop ran while the preview's API was still up, and the API, restarting before Dokploy removed it, made and seeded its database again at boot (#705);
- about 1,300 lines of workflow and scripts, and branches in the API, the panel and the phone app that only previews took;
- in the infrastructure: DNS and CAA records, an extra alias on staging's distribution, a certificate policy on the instance role, an SSM document that drops databases, a CloudFront Function, a lifecycle rule and two inline policies on the plan role.

## Decision

1. **No pull-request previews, in any lane.** `preview.yml`, `preview-cleanup.yml` and their scripts go (`dokploy-preview.sh`, `preview-comment.sh`, `pr-open.sh`, `withdraw-waiting-runs.sh` with its test), and with them the `actions: write` job of ADR-012 §8, the only one the repository had. A pull request deploys nothing anywhere before it merges. Staging stays the one shared deployed place to try a change, after the merge (ADR-018).
2. **A pull request's image is still built and smoke-tested** by `build.yml`, and is no longer pushed: only `main`'s and a tag's images reach GHCR.
3. **`APP_ENV` is `development`, `test`, `staging` or `production`.** `preview`, `PR_NUMBER`, `DB_PREVIEW_USER` and `DB_PREVIEW_PASSWORD` go from the API's configuration, with the database it created at boot, the seed at every boot, the lower request limit and `ssmPrefix`'s mapping. The seed and the demo tools no longer accept `--env preview`.
4. **An API without a broker answers 503 everywhere.** ADR-014 §1's preview, the one place where a missing broker sent the browser back to the app with `auth_unavailable`, is gone; a staging or production process without one answers 503, which the 5xx alarm sees.
5. **The panel is built only at `/`.** No `/pr-<n>/` base and no basename taken from it, no `pr-*` behaviour, Function or lifecycle rule on the panel's distribution, and no `admin-previews` policy on the plan role.
6. **The phone app's environments are `development`, `staging` and `production`.** No `preview` environment and no `pr-<n>` channel in `src/lib/environment.ts`.
7. **Kept on purpose:** the web target of `pnpm env:up` for local development; EAS's `preview` environment and the `preview` build profile in `eas.json`, which staging's builds and `deploy.yml` use and no pull request does; staging itself, `admin-deploy.yml` and the end-to-end workflows.

## Consequences

- What can publish an EAS Update is what lands on `main` and a run approved into `prod`, beside the GitHub organisation's owners and the Expo organisation's logins (ADR-004 §2). No pushed branch reaches `EXPO_TOKEN` or the staging instance role any more, once the environments `preview` and `preview-cleanup` are deleted with their tokens.
- Before a merge a change is tried on a developer's machine (`pnpm env:up` with the mock bank), in CI, and with the end-to-end flows on a pull request labelled `e2e`. A change that needs the real bank, real photos or a real phone on staging is tried there after the merge, as one already was.
- A translation reviewer reads the app on staging's build or on a developer's machine; there is no link on the pull request.
- The decisions log's TD-2 and TD-19 still name the previews until the maintainer amends them.
- The staging box carries staging's API alone: ADR-046's headroom no longer has to hold three more containers.
- Other records that name the previews (among them ADR-005, ADR-008, ADR-029 §12, ADR-043, ADR-046, ADR-052, ADR-054 and ADR-057) keep their text as it was decided; what they say of a preview no longer applies, and nothing else they decide changes.
- The panel's deploy syncs its build to the bucket's root with nothing under `pr-` left alone, so its first run after the merge removes whatever previews are left there (ADR-025 §4 and §5).

## Open, the maintainer's

Step 1 is #705's step 1, done before the pull request merged, since the cleanup went with it; the rest are #705's step 3 and follow the merge:

1. Done on 2026-11-16. Every preview still standing was removed (`gh workflow run preview-cleanup.yml -f pr=<n>`, the last run green in every job), `PREVIEWS_ENABLED` set to `false`, and what was left looked for: the API and web hosts of #696, #701, #704, #706 and #707 answer 404, the panel's bucket has no `pr-` prefix, and EAS Update has the branch `staging` alone. The staging RDS instance, read as `kuutti_preview` through a Session Manager port forward once the maintainer had signed in, still held twelve preview databases with no connection; they were dropped by hand on the maintainer's word, and the instance holds `kuutti`, `postgres` and `rdsadmin` alone (#705, the comment of 17:46 UTC). Dokploy was not read directly (step 4). Then the maintainer deleted the GitHub environment `preview` with its `DOKPLOY_TOKEN` and `EXPO_TOKEN`, read back through the API (404): it admitted every branch, so once nothing deployed a preview it was only a branch's way to the token that publishes updates and to the staging box (the security review of #705's pull request).
2. Done on 2026-11-18. `tofu apply` ran in `infra/bootstrap` by hand on 2026-11-17, on staging through `infra.yml` after the merges, and on production through `infra-prod.yml` from the tag `v0.125.0-rehearsal.1` on 2026-11-17: the records, the CAA record, the certificate policy, the SSM document, the distribution's alias, the plan role's two policies and the panel's `pr-*` behaviour and lifecycle rule are gone. The panel's Function `kuutti-<env>-admin-previews` was not destroyed by the apply. OpenTofu would delete it before updating the distribution that uses it, and CloudFront refuses that with 409 `FunctionInUse`, as staging's applies of #709 and #710 showed. So `modules/admin` had the state forget it (a `removed` block), and once an environment's apply was done the Function was deleted by hand: staging's by the maintainer on 2026-11-17, production's on his word on 2026-11-18, each read back (`list-functions` names no `admin-previews`). The `removed` block left `modules/admin` once both environments had applied it.
3. On the staging RDS instance drop the role `kuutti_preview`, which owns no database since step 1. The parameter `/kuutti/staging/db-preview-password` was deleted on the maintainer's word on 2026-11-18 and read back.
4. In Dokploy on staging delete the `previews` project, the `ci-preview` member with its API key (whose last copy outside Dokploy went with `preview-cleanup`, step 5), and the wildcard certificate in Traefik.
5. In GitHub the environment `preview-cleanup` with its `DOKPLOY_TOKEN` and `EXPO_TOKEN`, and the variable `PREVIEWS_ENABLED`, were deleted on the maintainer's word on 2026-11-18 and read back through the API (the environment answers 404, the variable is in no list); none of the fourteen required checks is a preview job (the ruleset read that day). Left: revoke the Expo robot token only if nothing else holds it.
6. Delete the `kuutti-api` versions tagged `pr-*` in GHCR, and what is left on EAS Hosting.
7. Amend TD-2 and TD-19 in the decisions log.

## Alternatives considered

- **Keep them dormant behind `PREVIEWS_ENABLED=false`.** Nothing would run, and nothing would be removed either: the workflows, the scripts, the API's, the panel's and the app's branches, the infrastructure and the trust they need would stay, to be read, tested and kept current for a feature nobody uses. Switching them back on later would meet whatever had drifted meanwhile.
- **Keep the API lane alone.** It is the lane that costs the box, the RDS instance and the instance role's trust; the other three cost little without it, and the web lane needs it.

## History

- 2026-11-16 (#705): written on the maintainer's word of that day, and built as written in the pull request for #705.
- 2026-11-16 (#705): Open 1 done before the merge: the staging instance's twelve leftover databases dropped by hand, and the environment `preview` deleted by the maintainer and read back through the API.
- 2026-11-17 (#705): Open 2 changed. Staging's apply failed on deleting the panel's Function while the distribution still used it, so `modules/admin` now has the state forget the Function and the maintainer deletes it by hand.
- 2026-11-18 (#705): Open 2 done: every apply has run, both Functions are deleted, and the `removed` block is out of `modules/admin`. Of Open 3 and 5, the parameter, the environment `preview-cleanup` and the variable `PREVIEWS_ENABLED` were deleted on the maintainer's word and read back, and the required checks were read.
