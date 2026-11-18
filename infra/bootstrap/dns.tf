# ---------------------------------------------------------------------------
# The project domain (TD-4). kuutti.app was registered through Route 53 in
# this account on 2026-09-17: a purchase with contact details, which cannot be
# code, so like the account itself it is the click-ops ADR-001 allows. Route 53
# created the hosted zone at registration. It is adopted here rather than
# recreated: a new zone would get other name servers than the registration
# points at. The import block stays, so a rebuilt state adopts it again.
# Records live with the environment that owns their target (envs/*/dns.tf)
# and look the zone up by name. Domain-wide records that belong to no
# environment live here: CAA, DMARC and the root's MX and SPF below with
# Google Workspace's key and verification, and the records SES sends mail by
# (mail.tf).
# ---------------------------------------------------------------------------

import {
  to = aws_route53_zone.main
  id = "Z004088624ZDOS9GD322O"
}

resource "aws_route53_zone" "main" {
  name    = var.domain
  comment = "HostedZone created by Route53 Registrar"

  lifecycle {
    prevent_destroy = true
  }
}

# ---------------------------------------------------------------------------
# Domain-wide policy records. Two services send as kuutti.app, and one of them
# receives (#450, ADR-043 §5):
# - Google Workspace holds the association's mailbox, admin@kuutti.app, which
#   every alarm mails (ALERT_EMAIL). It receives through the root's MX. It
#   sends with the sender's own address in the envelope, so the root's SPF
#   names Google, and it signs as d=kuutti.app with the key at
#   google._domainkey.
# - SES sends Kuutti's own mail as noreply@kuutti.app (mail.tf, #385). Its
#   envelope sender is mail.kuutti.app, whose own SPF names SES, so the root's
#   SPF need not, and Easy DKIM signs as d=kuutti.app.
# The reject DMARC holds for both: each signature aligns under adkim=s, and
# Google's envelope also aligns under aspf=s, while SES's, checked for
# mail.kuutti.app, does not and need not. Mail that neither signed fails
# DMARC, and receivers that honour it reject it, which is what stops the
# domain being spoofed. The one exception is mail that leaves Google's servers
# with a kuutti.app envelope: it passes on SPF alone, so that part rests on
# Google refusing such an envelope to its other customers. The SPF ends in ~all, Google's advice, rather than
# -all: DMARC does the rejecting, and a receiver that refuses a hard SPF fail
# outright never sees that a forwarded message's DKIM still passes.
#
# The maintainer set the Workspace up in the console on 2026-10-03, and Google
# gave a new verification code on 2026-10-15 (CloudTrail). The records are
# declared as they were live on 2026-10-25, and Google's key is adopted with
# an import block. In Route 53 a name has one TXT set, so Google's
# verification shares the root's with the SPF.
#
# CAA limits who may issue certificates for the domain to the two issuers in
# use: ACM (Amplify Hosting, later CloudFront) and Let's Encrypt (Traefik on
# the boxes). An issuer that refuses a request against it may report it to
# the mailbox (iodef). No issuewild, so issue governs wildcards too (RFC
# 8659): Amplify's ACM certificate for *.kuutti.app renews under the
# amazon.com entries; an issuewild here would have to admit ACM as well.
# ---------------------------------------------------------------------------

resource "aws_route53_record" "caa" {
  zone_id = aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "CAA"
  ttl     = 3600
  records = [
    "0 issue \"amazon.com\"",
    "0 issue \"amazontrust.com\"",
    "0 issue \"awstrust.com\"",
    "0 issue \"amazonaws.com\"",
    "0 issue \"letsencrypt.org\"",
    "0 iodef \"mailto:admin@${var.domain}\"",
  ]
}

# The records were the root's "-all" SPF and its null MX until the Workspace
# (#450): the same objects under the names of what they hold now.
moved {
  from = aws_route53_record.spf
  to   = aws_route53_record.root_txt
}

moved {
  from = aws_route53_record.null_mx
  to   = aws_route53_record.root_mx
}

resource "aws_route53_record" "root_txt" {
  zone_id = aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "TXT"
  ttl     = 300
  records = [
    "v=spf1 include:_spf.google.com ~all",
    # Google's proof that the domain is the association's, public like every
    # record. It stays after the check, since Google may read it again.
    "google-site-verification=POL6Nb15K44JSndMSeLscRDnM-1RtytXRDH_XyiM4tw",
  ]
}

resource "aws_route53_record" "dmarc" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  ttl     = 3600
  records = ["v=DMARC1; p=reject; adkim=s; aspf=s"]
}

resource "aws_route53_record" "root_mx" {
  zone_id = aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "MX"
  ttl     = 3600
  records = ["1 smtp.google.com"]
}

import {
  to = aws_route53_record.google_dkim
  id = "Z004088624ZDOS9GD322O_google._domainkey.kuutti.app_TXT"
}

# The public half of the key Google signs the Workspace's mail with, the
# selector "google". A TXT string holds at most 255 characters, so the key is
# two strings, the first of 255. A new key from Google replaces both: the
# Admin console generated this one on 2026-11-16, replacing that of #450, and
# signs with it once "Start authentication" is pressed after the apply.
resource "aws_route53_record" "google_dkim" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "google._domainkey.${var.domain}"
  type    = "TXT"
  ttl     = 300
  records = [join("\" \"", [
    "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqyEa1av/oao0++y1j9TRXz9A3ZqAEjb/A5fbhEWIIWg9R85/PWqKxQGmfL0WFcrPI6ENaectTwtoNO6tXvX3rTKCRYPIlf860qdazozP9s/Un2SvRiAlSoKie5aAqFAIi46JFYcH7slPnXZVB5u0dX8MamyDpPk21HJXoyimfbqhcKl2U20AtvUxFqnyX7c/z",
    "rILrSpEBlpRvgQ3Dn40Y1G36QaxwjOlnudmVorF5p+6rG+FzjTwUGFgHQwrHDRDeItTVscEh2E9mNhjnf2JPjVxLpV7YK7Bg6Z7Zh0e8EFUTCs0Yl8exBp94+n4eSAt6jnf2qjK0KeXc04Kkx41KQIDAQAB",
  ])]
}

# GitHub organisation domain verification (#16 B.1): the organisation shows
# kuutti.app as verified once this record answers. An owner starts the
# verification in the organisation's settings (Verified and approved domains),
# which shows the record name and its code; both go into terraform.tfvars.
# The code is a proof of control, not a secret. Empty until then: no record.
resource "aws_route53_record" "github_org_verification" {
  count   = var.github_domain_verification == null ? 0 : 1
  zone_id = aws_route53_zone.main.zone_id
  name    = "${var.github_domain_verification.name}.${var.domain}"
  type    = "TXT"
  ttl     = 300
  records = [var.github_domain_verification.code]
}

# ---------------------------------------------------------------------------
# The second domain. kumpa.fi was registered through Route 53 in this account
# in November 2026, the same click-ops as kuutti.app's, and its hosted zone is
# adopted the same way. It serves the website beside kuutti.app, which stays
# the home: Amplify Hosting wrote the apex alias, www and the certificate's
# validation record, ADR-001's documented exception, so they are not declared
# here.
#
# The domain is a secondary domain of the association's Google Workspace
# (2026-11-16): the MX, Google's verification and the SPF were made with the
# CLI that day for Gmail's activation and are adopted with import blocks, as
# Google's key for kuutti.app was in #450. What the SPF and the MX mean is
# kuutti.app's story above. Google's DKIM key for kumpa.fi came from the
# Admin console the same day and is declared below, never clicked.
#
# The DMARC and the CAA are kuutti.app's, declared here first, on the
# maintainer's word of 2026-11-16. A domain with a mailbox and no DMARC lets
# anyone send as it with only a soft fail. Google's envelope carries the
# sender's own address, so its mail aligns under aspf=s, and its signature
# as d=kumpa.fi aligns under adkim=s, which carries a forwarded message that
# breaks SPF. The CAA names the issuers kuutti.app's does: ACM for Amplify's
# certificate and the distributions', and Let's Encrypt since the boxes serve
# api, dokploy and origin.api under kumpa.fi as well, with a certificate from
# Traefik for each (#703, ADR-072).
#
# SES sends as kumpa.fi too, through an identity of its own (mail.tf): its
# Easy DKIM signs as d=kumpa.fi, which aligns under adkim=s, and its envelope,
# mail.kumpa.fi, has its own SPF, as kuutti.app's does.
# ---------------------------------------------------------------------------

import {
  to = aws_route53_zone.kumpa
  id = "Z009772612PD4XK4EUJKZ"
}

resource "aws_route53_zone" "kumpa" {
  name    = "kumpa.fi"
  comment = "HostedZone created by Route53 Registrar"

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = aws_route53_record.kumpa_mx
  id = "Z009772612PD4XK4EUJKZ_kumpa.fi_MX"
}

resource "aws_route53_record" "kumpa_mx" {
  zone_id = aws_route53_zone.kumpa.zone_id
  name    = "kumpa.fi"
  type    = "MX"
  ttl     = 300
  records = ["1 smtp.google.com."]
}

import {
  to = aws_route53_record.kumpa_txt
  id = "Z009772612PD4XK4EUJKZ_kumpa.fi_TXT"
}

resource "aws_route53_record" "kumpa_txt" {
  zone_id = aws_route53_zone.kumpa.zone_id
  name    = "kumpa.fi"
  type    = "TXT"
  ttl     = 300
  records = [
    "google-site-verification=B0InikoK6q0-A4gtwI4N2So6V7VKprw6_iq2C5J_8j8",
    "v=spf1 include:_spf.google.com ~all",
  ]
}

resource "aws_route53_record" "kumpa_dmarc" {
  zone_id = aws_route53_zone.kumpa.zone_id
  name    = "_dmarc.kumpa.fi"
  type    = "TXT"
  ttl     = 3600
  records = ["v=DMARC1; p=reject; adkim=s; aspf=s"]
}

resource "aws_route53_record" "kumpa_caa" {
  zone_id = aws_route53_zone.kumpa.zone_id
  name    = "kumpa.fi"
  type    = "CAA"
  ttl     = 3600
  records = [
    "0 issue \"amazon.com\"",
    "0 issue \"amazontrust.com\"",
    "0 issue \"awstrust.com\"",
    "0 issue \"amazonaws.com\"",
    "0 issue \"letsencrypt.org\"",
    "0 iodef \"mailto:admin@${var.domain}\"",
  ]
}

# Google's key for kumpa.fi, generated in the Admin console on 2026-11-16 with
# kumpa.fi selected: a key of its own, not kuutti.app's. A TXT string holds at
# most 255 characters, so the key is two strings, the first of exactly 255.
resource "aws_route53_record" "kumpa_google_dkim" {
  zone_id = aws_route53_zone.kumpa.zone_id
  name    = "google._domainkey.kumpa.fi"
  type    = "TXT"
  ttl     = 300
  records = [join("\" \"", [
    "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArK2qppUBPBG5ruwgWoKlLCJblJnFGsi24Ln+be+Q2+VMo3gi4dvWYTCdAbVpmxz1AG6A+ck7+rf5bZ/yKT8PDYaSZTFTrDPpHgIe3u9Lnq9Ls5wUilBBbGy0fakmVNqCwQT3kx95IhIt7DpGMhG4tUvee/bUtBSpjRkSthiGU8DWGi/2fW7ikbu6kSnBAVv43",
    "A0lgAB187vd52xIXhPlZBZc9gUHqgBBSqZjgZ9boep2KdvoOynp3hbcZPH8XmGAsdniOSHbrea1ol/T15pfufD+PX795KJbh7CaI1+0/rCAqn4g2B53Gf8ilo+sw64WtFHHsywlzmH04DEKQjNaewIDAQAB",
  ])]
}

# ---------------------------------------------------------------------------
# The misspelling. kunpa.fi, with an n, was registered on 2026-11-17 so that
# somebody who types it lands on kumpa.fi (#726). It is registered at Zoner
# and not through Route 53, so no registration made a zone: this one is
# created here, the first zone that is, and its four name servers are entered
# at Zoner by hand (output kunpa_name_servers). A recreated zone would get
# other name servers than Zoner points at, hence prevent_destroy, as above.
#
# Zoner's own forwarding answers on http alone: over https it presents a
# certificate for its own name. So the name is a domain of the Amplify app,
# which holds a certificate for it and answers a 301 to the same path on
# kumpa.fi (infra/README.md, The website). Amplify writes the apex alias, www
# and the certificate's validation record, ADR-001's documented exception,
# and a bare domain needs that alias, which is why the DNS is here at all.
#
# The name sends and receives no mail, and the records below say so, as
# kuutti.app's said before its Workspace (#450): a null MX (RFC 7505), an SPF
# that admits nobody and the reject DMARC, so nobody else sends as it either.
# The CAA names Amazon's issuers alone: nothing but Amplify's ACM certificate
# is ever issued for it.
# ---------------------------------------------------------------------------

resource "aws_route53_zone" "kunpa" {
  name    = "kunpa.fi"
  comment = "The misspelling of kumpa.fi, redirected to it (#726)"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_route53_record" "kunpa_mx" {
  zone_id = aws_route53_zone.kunpa.zone_id
  name    = "kunpa.fi"
  type    = "MX"
  ttl     = 3600
  records = ["0 ."]
}

resource "aws_route53_record" "kunpa_txt" {
  zone_id = aws_route53_zone.kunpa.zone_id
  name    = "kunpa.fi"
  type    = "TXT"
  ttl     = 3600
  records = ["v=spf1 -all"]
}

resource "aws_route53_record" "kunpa_dmarc" {
  zone_id = aws_route53_zone.kunpa.zone_id
  name    = "_dmarc.kunpa.fi"
  type    = "TXT"
  ttl     = 3600
  records = ["v=DMARC1; p=reject; adkim=s; aspf=s"]
}

resource "aws_route53_record" "kunpa_caa" {
  zone_id = aws_route53_zone.kunpa.zone_id
  name    = "kunpa.fi"
  type    = "CAA"
  ttl     = 3600
  records = [
    "0 issue \"amazon.com\"",
    "0 issue \"amazontrust.com\"",
    "0 issue \"awstrust.com\"",
    "0 issue \"amazonaws.com\"",
    "0 iodef \"mailto:admin@${var.domain}\"",
  ]
}
