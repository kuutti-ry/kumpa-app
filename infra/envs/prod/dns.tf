# DNS for prod (TD-4): the zone belongs to the bootstrap (adopted from the
# Route 53 registration), the records to the environment that owns the
# address: the API and Dokploy's own UI and API (called by CI). Traefik on the
# box terminates TLS with one Let's Encrypt certificate per host. With
# media_enabled both names are the CloudFront distribution's (ADR-005; §7 and
# #198 for Dokploy) and the box answers to origin.api; without it they point
# at the Elastic IP.
# The moderation panel's admin is the alias of its own distribution, declared
# with it in modules/admin (ADR-025).
# Every host has a second name under each of extra_domains, kumpa.fi, until
# kuutti.app's retire (ADR-072): the same targets, in that domain's zone.

data "aws_route53_zone" "main" {
  name = var.domain
}

# The zones of the second names, declared in infra/bootstrap with the
# project's (ADR-072).
data "aws_route53_zone" "extra" {
  for_each = toset(var.extra_domains)

  name = each.key
}

# With media_enabled, api is the distribution's alias (modules/media) and the
# box answers to origin.api for CloudFront (ADR-005). Dokploy's name is then
# the distribution's extra alias (ADR-005 §7, #198): the same record with the
# distribution as its target, so that the cutover's apply moves it in one
# change instead of deleting one record and creating another.
locals {
  behind_cloudfront = var.media_enabled ? ["dokploy"] : []
}

resource "aws_route53_record" "box" {
  for_each = toset(concat(["dokploy"], var.media_enabled ? ["origin.api"] : ["api"]))

  zone_id = data.aws_route53_zone.main.zone_id
  name    = "${each.key}.${var.domain}"
  type    = "A"
  ttl     = contains(local.behind_cloudfront, each.key) ? null : 300
  records = contains(local.behind_cloudfront, each.key) ? null : [module.compute.public_ip]

  dynamic "alias" {
    for_each = contains(local.behind_cloudfront, each.key) ? [1] : []
    content {
      name                   = module.media[0].distribution_domain_name
      zone_id                = module.media[0].distribution_hosted_zone_id
      evaluate_target_health = false
    }
  }
}

# The distribution answers over IPv6 as well (is_ipv6_enabled), as api does;
# the box has no IPv6 address of its own.
resource "aws_route53_record" "distribution_ipv6" {
  for_each = toset(local.behind_cloudfront)

  zone_id = data.aws_route53_zone.main.zone_id
  name    = "${each.key}.${var.domain}"
  type    = "AAAA"

  alias {
    name                   = module.media[0].distribution_domain_name
    zone_id                = module.media[0].distribution_hosted_zone_id
    evaluate_target_health = false
  }
}

# The second names (ADR-072). With media_enabled, api and dokploy are the
# distribution's aliases (module media's extra_aliases, main.tf) and
# origin.api is the box; without it, as until the cutover, api and dokploy
# point at the Elastic IP. The distribution connects to the box by
# origin.api.<domain>: its second name is there for the day kuutti.app's
# retire, when the origin moves to it.
locals {
  extra_hosts = merge([
    for d in var.extra_domains : {
      for label in concat(["api", "dokploy"], var.media_enabled ? ["origin.api"] : []) :
      "${label}.${d}" => {
        zone_id      = data.aws_route53_zone.extra[d].zone_id
        distribution = var.media_enabled && label != "origin.api"
      }
    }
  ]...)
}

resource "aws_route53_record" "extra_box" {
  for_each = local.extra_hosts

  zone_id = each.value.zone_id
  name    = each.key
  type    = "A"
  ttl     = each.value.distribution ? null : 300
  records = each.value.distribution ? null : [module.compute.public_ip]

  dynamic "alias" {
    for_each = each.value.distribution ? [1] : []
    content {
      name                   = module.media[0].distribution_domain_name
      zone_id                = module.media[0].distribution_hosted_zone_id
      evaluate_target_health = false
    }
  }
}

resource "aws_route53_record" "extra_distribution_ipv6" {
  for_each = { for fqdn, host in local.extra_hosts : fqdn => host if host.distribution }

  zone_id = each.value.zone_id
  name    = each.key
  type    = "AAAA"

  alias {
    name                   = module.media[0].distribution_domain_name
    zone_id                = module.media[0].distribution_hosted_zone_id
    evaluate_target_health = false
  }
}
