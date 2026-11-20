# The website's public launch list has its own storage and signup service.
# It runs in Frankfurt with the project's production data (TD-4, ADR-001).
locals {
  waitlist_name = "kuutti-prod-launch-waitlist"
  waitlist_host = "waitlist.kumpa.fi"
  waitlist_zone = var.domain == "kumpa.fi" ? data.aws_route53_zone.main.zone_id : data.aws_route53_zone.extra["kumpa.fi"].zone_id
}

resource "aws_dynamodb_table" "waitlist" {
  for_each = { signups = { suffix = "", key = "email" }, challenges = { suffix = "-challenges", key = "token" } }

  name                        = "${local.waitlist_name}${each.value.suffix}"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = each.value.key
  deletion_protection_enabled = true

  attribute {
    name = each.value.key
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  # DynamoDB encrypts both tables at rest using its AWS-owned key.
  dynamic "point_in_time_recovery" {
    for_each = each.key == "signups" ? [1] : []
    content {
      enabled                 = true
      recovery_period_in_days = 7
    }
  }
}

# CI can plan changes to these resources without accessing the data inside.
resource "aws_dynamodb_resource_policy" "waitlist" {
  for_each     = aws_dynamodb_table.waitlist
  resource_arn = each.value.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "KeepWaitlistDataOutOfCI"
      Effect    = "Deny"
      Principal = "*"
      Action = [
        "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem", "dynamodb:GetItem",
        "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
        "dynamodb:Scan", "dynamodb:Query", "dynamodb:PartiQL*",
        "dynamodb:ExportTableToPointInTime", "dynamodb:CreateBackup",
        "dynamodb:RestoreTableToPointInTime", "dynamodb:ConditionCheckItem"
      ]
      Resource  = each.value.arn
      Condition = { ArnLike = { "aws:PrincipalArn" = "arn:aws:iam::${local.account_id}:role/kuutti/kuutti-ci-*" } }
    }]
  })
}

resource "aws_iam_role" "waitlist" {
  name                 = local.waitlist_name
  path                 = "/kuutti/"
  permissions_boundary = local.permissions_boundary_arn
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "waitlist" {
  role = aws_iam_role.waitlist.id
  name = "receive-signups"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "dynamodb:PutItem", Resource = aws_dynamodb_table.waitlist["signups"].arn },
      { Effect = "Allow", Action = ["dynamodb:PutItem", "dynamodb:DeleteItem"], Resource = aws_dynamodb_table.waitlist["challenges"].arn }
    ]
  })
}

data "archive_file" "waitlist" {
  type        = "zip"
  output_path = "${path.root}/.terraform/launch-waitlist.zip"
  dynamic "source" {
    for_each = toset(["handler.py", "captcha.py"])
    content {
      filename = source.value
      content  = file("${path.module}/waitlist/${source.value}")
    }
  }
}

resource "aws_lambda_function" "waitlist" {
  function_name    = local.waitlist_name
  role             = aws_iam_role.waitlist.arn
  runtime          = "python3.13"
  architectures    = ["arm64"]
  handler          = "handler.handler"
  filename         = data.archive_file.waitlist.output_path
  source_code_hash = data.archive_file.waitlist.output_base64sha256
  timeout          = 8

  environment {
    variables = {
      WAITLIST_TABLE      = aws_dynamodb_table.waitlist["signups"].name
      WAITLIST_CHALLENGES = aws_dynamodb_table.waitlist["challenges"].name
    }
  }
}

resource "aws_apigatewayv2_api" "waitlist" {
  name                         = local.waitlist_name
  protocol_type                = "HTTP"
  disable_execute_api_endpoint = true
}

resource "aws_apigatewayv2_integration" "waitlist" {
  api_id                 = aws_apigatewayv2_api.waitlist.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.waitlist.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "waitlist" {
  for_each  = toset(["challenge", "join"])
  api_id    = aws_apigatewayv2_api.waitlist.id
  route_key = "POST /${each.key}"
  target    = "integrations/${aws_apigatewayv2_integration.waitlist.id}"
}

resource "aws_apigatewayv2_stage" "waitlist" {
  api_id      = aws_apigatewayv2_api.waitlist.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_rate_limit  = 5
    throttling_burst_limit = 20
  }
}

resource "aws_lambda_permission" "waitlist" {
  for_each      = aws_apigatewayv2_route.waitlist
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.waitlist.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.waitlist.execution_arn}/$default/POST/${each.key}"
}

resource "aws_acm_certificate" "waitlist" {
  domain_name       = local.waitlist_host
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "waitlist_certificate" {
  zone_id = local.waitlist_zone
  name    = one(aws_acm_certificate.waitlist.domain_validation_options).resource_record_name
  type    = one(aws_acm_certificate.waitlist.domain_validation_options).resource_record_type
  records = [one(aws_acm_certificate.waitlist.domain_validation_options).resource_record_value]
  ttl     = 300
}

resource "aws_acm_certificate_validation" "waitlist" {
  certificate_arn         = aws_acm_certificate.waitlist.arn
  validation_record_fqdns = [aws_route53_record.waitlist_certificate.fqdn]
}

resource "aws_apigatewayv2_domain_name" "waitlist" {
  domain_name = local.waitlist_host
  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.waitlist.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "waitlist" {
  api_id      = aws_apigatewayv2_api.waitlist.id
  domain_name = aws_apigatewayv2_domain_name.waitlist.domain_name
  stage       = aws_apigatewayv2_stage.waitlist.id
}

resource "aws_route53_record" "waitlist" {
  zone_id = local.waitlist_zone
  name    = local.waitlist_host
  type    = "A"
  alias {
    name                   = aws_apigatewayv2_domain_name.waitlist.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.waitlist.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}
