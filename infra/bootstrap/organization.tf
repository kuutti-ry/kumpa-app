# ---------------------------------------------------------------------------
# The organisation: enabling Identity Center made this account the management
# account of an organisation of its own (infra/README.md, step 5), so what
# holds for every account of it is set here, where only the maintainer
# applies. Adopted by import, never created or destroyed by this stack (#691).
# ---------------------------------------------------------------------------

data "aws_organizations_organization" "current" {}

import {
  to = aws_organizations_organization.this
  id = data.aws_organizations_organization.current.id
}

resource "aws_organizations_organization" "this" {
  feature_set          = "ALL"
  enabled_policy_types = ["AISERVICES_OPT_OUT_POLICY"]

  lifecycle {
    prevent_destroy = true
    # Trusted access belongs to the services that asked for it, Identity Center
    # first: a list here that missed one would switch it off.
    ignore_changes = [aws_service_access_principals]

    # enabled_policy_types is the whole list, and a type missing from it is
    # switched off: never adopt an organisation this account does not manage.
    precondition {
      condition     = data.aws_organizations_organization.current.master_account_id == data.aws_caller_identity.current.account_id
      error_message = "organization.tf adopts only the organisation this account manages."
    }
  }
}

# AWS may use what its AI services are sent to improve them unless the
# organisation opts out (ADR-006 §1): Rekognition is sent every photo's card and
# every photo of a conversation. One policy for every service it covers, now and
# later, at the root, so it holds for every account, this management account
# included (#691).
resource "aws_organizations_policy" "ai_services_opt_out" {
  name        = "${var.project}-ai-services-opt-out"
  description = "No AI service the opt-out covers may use this organisation's content to improve itself (ADR-006, #691)"
  type        = "AISERVICES_OPT_OUT_POLICY"
  # AWS's own example for every service at the root: no policy attached below
  # it may opt a service back in.
  content = jsonencode({
    services = {
      "@@operators_allowed_for_child_policies" = ["@@none"]
      default = {
        "@@operators_allowed_for_child_policies" = ["@@none"]
        opt_out_policy = {
          "@@operators_allowed_for_child_policies" = ["@@none"]
          "@@assign"                               = "optOut"
        }
      }
    }
  })

  depends_on = [aws_organizations_organization.this]
}

resource "aws_organizations_policy_attachment" "ai_services_opt_out" {
  policy_id = aws_organizations_policy.ai_services_opt_out.id
  target_id = aws_organizations_organization.this.roots[0].id
}
