# ADR-072: Two names, then kumpa.fi alone

- Status: proposed (#703, on the maintainer's word of 2026-11-16 in chat; §1 to §6 built as written here in the pull request for #703; the applies, the Workspace alias and the mail to Telia are his; §7 and §8 wait on Telia's answer and on the installed builds; accepting it is the maintainer's)
- Date: 2026-11-17
- Follows: TD-4 (one vendor, AWS, and the association's own accounts and domain), TD-1 (every account is a bank login, so the bank's callback cannot break), ADR-001 (declared in code; the bootstrap applied by hand), ADR-005 §7 (what the box serves on 443 is behind the distribution), ADR-025 §3 and §10 (the panel's CSP and its origin), ADR-043 §5 and §6 (the mail identity and staging's recipients), ADR-048 (the control-plane pin), ADR-070 (no previews), CLAUDE.md rule 8; issues #703, #700, #698, #25. It amends ADR-025 §10 (the panel's origins), ADR-043 §5 and §6 (the identities and staging's list) and ADR-048 §3 (the pin, per name)

## Context

The app is called Kumpa; Kuutti ry is the association that runs it. On 2026-11-16 the maintainer decided that the servers, the moderation panel and the mail move to `kumpa.fi`, as the website already had beside `kuutti.app` (#698): "AWS is using kumpa.fi instead of https://api.kuutti.app/health and https://api.staging.kuutti.app/health and so on". Asked how, he chose both names first and `kuutti.app`'s retired later, the mail as `Kumpa <noreply@kumpa.fi>` through an SES identity of its own, and a mail to Telia that the agent drafts and he sends.

What names `kuutti.app` on that day:

- **The hosts.** `api`, `origin.api` (with photos on, the name CloudFront connects to the box by), `dokploy` and `admin`, staging's under `staging.`. Production's API is live at `api.kuutti.app`; its photos and its CloudFront are not on yet, so its `api` and `dokploy` point at the Elastic IP.
- **What is built or registered with a name.** Every installed build calls the API address it was built with (`EXPO_PUBLIC_API_URL`), until the person updates. The invitation link is `api.kuutti.app/i/{code}`. Telia registers redirect URIs exactly, with no wildcard, by mail to id-maintenance, and the API sends the registered one, never the request's Host (`docs/vendors/telia.md`). The display name `ftn_spname` is "Kuutti", which the bank shows as "lähettäjä Kuutti" (#700).
- **The configuration.** The API's parameters (the bank's callback, `admin-app-url`, `media-url-base`), the panel's build and its CSP, `MAIL_FROM`, and the GitHub environments' `API_URL`, `DOKPLOY_URL` and `ADMIN_URL`.

Taking `kuutti.app` away before all of that has moved would cut off every installed build and every sign-in. Sign-in sets no cookie at the API, so `/auth/start` and `/auth/callback` may be on different hosts, and a host may get a second name without anyone signing in again.

The `kumpa.fi` zone is in this account since #698, adopted in `infra/bootstrap/dns.tf` with Google Workspace's records, a reject DMARC and a CAA for Amazon's issuers alone. #703 also listed the previews' wildcard under `preview.api.staging`, its CAA and its DNS-01 right, and `PREVIEW_API_DOMAIN`; the previews went with ADR-070 before this was built, and so did those lines.

## Decision

1. **Both names first.** Every host gets a second name under `kumpa.fi`, with the same target as its `kuutti.app` one: `api`, `origin.api`, `dokploy` and `admin`, staging's under `staging.`. Each environment's `extra_domains` (`["kumpa.fi"]`) gives them; `domain` stays `kuutti.app`, the one the configuration names. `dns.tf` writes the records in that domain's zone. The API's distribution and the panel's carry the names as aliases, and each certificate names both domains, every name validated in its own zone: modules `media` and `admin` take each extra alias with the zone it lives in. `origin.api.<env>.kumpa.fi` exists only where `origin.api.<env>.kuutti.app` does, with photos on, and the distribution still connects by the `kuutti.app` one.
2. **Nothing switches yet.** The API's parameters, the panel's build, `MAIL_FROM`, the builds, the GitHub variables and the invitation link keep naming `kuutti.app`. The panel's CSP `connect-src` names the API origin its build uses, `https://api.<env>.kuutti.app`, under both of the panel's names, and moves with `API_URL`. `admin-deploy.yml` already holds the two together.
3. **Traefik holds every name.** `dokploy-setup.sh` gives the API application both API hosts, and the pin of ADR-048 keeps every name of `dokploy` and of `api` with its owner. Each name gets a pair of routers of its own, so each has its own certificate, and a name that stops answering Let's Encrypt cannot hold up another's renewal. Dokploy's own domain takes one host, and it stays `kuutti.app`'s, the one `deploy.yml` calls. `kumpa.fi`'s CAA admits Let's Encrypt, as `kuutti.app`'s does, since the boxes now serve names there.
4. **The panel's origins.** `cors-allowed-origins` holds both of the panel's origins while it has two. That is the only new browser origin: rule 8's surface is the same panel under another name.
5. **Mail.** `kumpa.fi` is a second SES identity, in the shape of `kuutti.app`'s (`infra/bootstrap/mail.tf`): Easy DKIM as `d=kumpa.fi`, which aligns under the zone's `adkim=s`, and the MAIL FROM `mail.kumpa.fi` with its MX and an SPF of its own. The instance role may send as `noreply@` of either domain (`modules/compute`, `mail_domains`, statement `SesSendAsNoreply`). Staging's default recipients name both senders. Nothing sends through the new identity until `MAIL_FROM` says `Kumpa <noreply@kumpa.fi>` (§7).
6. **Telia.** One mail from the maintainer to id-maintenance asks Telia to register the `kumpa.fi` callbacks beside the present ones: `https://api.staging.kumpa.fi/auth/callback` for the pre-production client and `https://api.kumpa.fi/auth/callback` for production's. It also asks for **Kumpa** as `ftn_spname` and `client_name`, which covers #700's "lähettäjä Kuutti". The agent drafts it in the maintainer's mailbox and never sends it, and Telia's answer is written into `docs/vendors/telia.md`.
7. **The switch** is its own change, made once Telia has said yes and the Workspace alias `noreply@kumpa.fi` exists. It covers the bank's callback (`oidc-redirect-uri`, `telia-keys.sh`'s metadata), `MAIL_FROM`, `EXPO_PUBLIC_API_URL` in the EAS environments, the GitHub variables, `admin-app-url` and the panel's API origin with its CSP, `media-url-base`, the invitation link's host and `SITE_URL`, the runbooks, the load smoke, the drawings and the store listings. Whether `domain` itself flips is for that change to plan. The records are keyed by name, so flipping it in place would plan every record again under the other zone; the plan is read for a record deleted and made in the same apply.
8. **The retirement.** Once no installed build calls a `kuutti.app` host, those hosts go: their records, the aliases, the certificates' names, the pin's routers, the old Telia callbacks and `kuutti.app`'s place in `mail_domains`. The distribution's origin then moves to `origin.api.<env>.kumpa.fi`, which needs Traefik's certificate first (a Dokploy domain on the application). The `kuutti.app` zone stays: the website and the association's Workspace mail live there.

## Consequences

- Nothing goes down on the way. Every present name keeps its target. The two certificates are replaced by ones that name both domains, the new one made and validated before the distribution moves to it and the old one removed after (`create_before_destroy`).
- A second public name for the API, the panel and Dokploy's control plane. Each one reaches the same place by the same path as the first: on staging through the distribution, with the proof of ADR-066 and the edge's rule of ADR-067; on production straight to the box until its cutover. The pin keeps the new names with their owners.
- The edge's rate rule counts a viewer across both names, since it is the distribution's. The outside probe still asks `api.<env>.kuutti.app`.
- A staff sign-in started on the `kumpa.fi` panel returns to `admin-app-url`, the `kuutti.app` panel. The page asked for is kept per origin and is lost, so the panel opens at its start. Until the switch, staff use the `kuutti.app` panel.
- A photo URL is signed for the API's `kuutti.app` name and opens only there; nothing hands one out under `kumpa.fi` before the switch.
- Staging's default recipients name `noreply@kumpa.fi` before the alias exists. The default is not in force, since `MAIL_TESTERS` is set. A code sent there before the alias would bounce, and SES would put the address on the account's suppression list.
- Cost: none to speak of. The zone is already paid for; the records, the certificates and the SES identity are free.

## Open, the maintainer's

1. `tofu apply` in `infra/bootstrap` by hand: the `kumpa.fi` identity, its MAIL FROM and five records, and the CAA changed in place. Then the identity's verification (`infra/README.md`, Mail, step 2).
2. Staging through `infra.yml` after the merge, a redeploy of the API so that it reads the new origins, `dokploy-setup.sh staging`, and the checks of `infra/README.md`, Two names. Production at its next release tag (`infra-prod.yml`), then `dokploy-setup.sh prod`.
3. Sending the mail to Telia from the draft, and the answer, which goes into `docs/vendors/telia.md`.
4. The Workspace alias `noreply@kumpa.fi`.
5. At §8, how to tell that no installed build calls `kuutti.app`, for example from Traefik's access log by host or from a minimum app version, and how long a quiet spell is enough.

## Left out on purpose, and what would make it needed

- **A probe for the `kumpa.fi` API.** Nothing calls that name before the switch; the switch moves the probe.
- **`origin.api.<env>.kumpa.fi` as a Dokploy domain now.** It is needed only when the distribution's origin moves (§8).
- **The switch's pieces**, §7, which wait on Telia and the alias.

## Alternatives considered

- **Renaming in one go.** Every installed build and every sign-in would break until the builds had moved and Telia had answered.
- **Redirecting `kuutti.app` to `kumpa.fi`.** A redirect does nothing for the bank, which returns to the exact registered address. Not every client follows one for a POST, and both names would still need a certificate.
- **One ordered list of domains, the first being the configuration's.** The same model with a wider diff, since every `var.domain` would change.
- **One router per control-plane host with both names in its rule.** Traefik would then ask for one certificate naming both, whose renewal fails as soon as either name stops answering.

## History

- 2026-11-17: written, and §1 to §6 built in the pull request for #703; the mail to Telia of §6 drafted for the maintainer to send.
