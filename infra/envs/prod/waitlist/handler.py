import base64
import hashlib
import json
import logging
import os
import re
from datetime import UTC, datetime, timedelta
from functools import cache
from urllib.parse import parse_qsl

import captcha

ORIGINS = {
    "https://kumpa.fi", "https://www.kumpa.fi",
    "https://kuutti.app", "https://www.kuutti.app",
}
MAX_FORM_BYTES = 2048
RETENTION = timedelta(days=365)
CONSENT_VERSION = "launch-v1"
ATOM = r"[a-z0-9!#$%&'*+/=?^_`{|}~-]+"
LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
ADDRESS = re.compile(rf"{ATOM}(?:\.{ATOM})*@{LABEL}(?:\.{LABEL})+", re.ASCII)

COPY = {
    "en": {
        "saved": ("You're on the list", "We'll email you when Kumpa launches."),
        "email": ("Check your email address", "Go back and enter the address where you'd like to hear from us."),
        "form": ("Please use the signup form", "Visit the Kumpa website to join the waiting list."),
        "busy": ("We couldn't save your signup", "Please return to the website and try again in a moment."),
        "retry": ("Please try signing up again", "The automatic check could not be completed. Return to the website and submit the form again."),
        "home": "Back to the Kumpa website",
    },
    "fi": {
        "saved": ("Olet odotuslistalla", "Lähetämme sinulle sähköpostia, kun Kumpa-sovellus julkaistaan."),
        "email": ("Tarkista sähköpostiosoitteesi", "Palaa lomakkeelle ja kirjoita osoite, johon haluat tiedon julkaisusta."),
        "form": ("Käytä sivuston lomaketta", "Voit liittyä odotuslistalle Kumpa-sivustolla."),
        "busy": ("Tietojen tallennus epäonnistui", "Palaa sivustolle ja yritä hetken kuluttua uudelleen."),
        "retry": ("Yritä liittyä uudelleen", "Automaattinen tarkistus epäonnistui. Palaa sivustolle ja lähetä lomake uudelleen."),
        "home": "Takaisin Kumpa-sivustolle",
    },
}

STYLE = """
* { box-sizing: border-box; }
body { margin: 0; color: #101828; background: #fff; font: 1.125rem/1.55 system-ui, sans-serif; }
header { padding: 1rem max(1.25rem, calc((100% - 66rem)/2)); background: #fae8ee; font-weight: 750; }
main { width: min(100%, 41rem); margin: clamp(2rem, 10vh, 7rem) auto; padding: 0 1.25rem; }
h1 { margin: 0; font-size: clamp(2rem, 6vw, 3.25rem); line-height: 1.1; overflow-wrap: anywhere; }
a { display: inline-flex; align-items: center; min-height: 44px; color: #2049b0; }
:focus-visible { outline: 3px solid #2049b0; outline-offset: 3px; }
small { display: block; margin-top: 2rem; }
"""
STYLE_HASH = base64.b64encode(hashlib.sha256(STYLE.encode()).digest()).decode()


def response(status, message, locale, origin):
    copy = COPY[locale]
    title, detail = copy[message]
    home = origin if origin in ORIGINS else "https://kumpa.fi"
    notice = "<small>Konekäännös</small>" if locale == "fi" else ""
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Content-Security-Policy": (
                f"default-src 'none'; style-src 'sha256-{STYLE_HASH}'; "
                "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
            ),
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "X-Robots-Tag": "noindex, nofollow",
        },
        "body": f"""<!doctype html>
<html lang="{locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · Kumpa</title><style>{STYLE}</style></head>
<body><header>Kumpa</header><main><h1>{title}</h1><p>{detail}</p>
<a href="{home}/">{copy["home"]}</a>{notice}</main></body></html>""",
    }


def json_response(status, data, origin):
    headers = {
        "Content-Type": "application/json", "Cache-Control": "no-store",
        "Vary": "Origin", "X-Content-Type-Options": "nosniff",
    }
    if origin in ORIGINS:
        headers["Access-Control-Allow-Origin"] = origin
    return {"statusCode": status, "headers": headers, "body": json.dumps(data)}


def read_form(event, issuing):
    body = event.get("body") or ""
    if len(body) > 4 * ((MAX_FORM_BYTES + 2) // 3):
        raise ValueError("large form")
    raw = base64.b64decode(body, validate=True) if event.get("isBase64Encoded") else body.encode()
    if len(raw) > MAX_FORM_BYTES:
        raise ValueError("large form")
    pairs = parse_qsl(
        raw.decode("utf-8"), keep_blank_values=True, strict_parsing=True,
        errors="strict", max_num_fields=4,
    )
    form = dict(pairs)
    allowed = {"email", "locale", "website"}
    if not issuing:
        allowed.add("altcha")
    if len(form) != len(pairs) or set(form) - allowed:
        raise ValueError("unexpected fields")
    if form.get("locale") not in COPY:
        raise ValueError("invalid language")
    return form


@cache
def database():
    import boto3  # Included in the Lambda runtime.
    return boto3.client("dynamodb")


def save(client, email, locale):
    now = datetime.now(UTC).replace(microsecond=0)
    try:
        client.put_item(
            TableName=os.environ["WAITLIST_TABLE"],
            Item={
                "email": {"S": email},
                "locale": {"S": locale},
                "createdAt": {"S": now.isoformat()},
                "expiresAt": {"N": str(int((now + RETENTION).timestamp()))},
                "consentVersion": {"S": CONSENT_VERSION},
            },
            # DynamoDB may retain expired items for a few days before deleting them.
            ConditionExpression="attribute_not_exists(#email) OR #expiry <= :now",
            ExpressionAttributeNames={"#email": "email", "#expiry": "expiresAt"},
            ExpressionAttributeValues={":now": {"N": str(int(now.timestamp()))}},
        )
    except client.exceptions.ConditionalCheckFailedException:
        # An active signup keeps its original consent and expiry on resubmission.
        pass


def handler(event, context):
    headers = event.get("headers") or {}
    origin = headers.get("origin")
    locale = "en" if headers.get("accept-language", "").lower().startswith("en") else "fi"
    route = event.get("routeKey")
    issuing = route == "POST /challenge"

    def reject(status, message):
        if issuing:
            return json_response(status, {"error": message}, origin)
        return response(status, message, locale, origin)

    if event.get("requestContext", {}).get("http", {}).get("method") != "POST":
        result = reject(405, "form")
        result["headers"]["Allow"] = "POST"
        return result
    if route not in {"POST /join", "POST /challenge"}:
        return reject(404, "form")
    if origin not in ORIGINS:
        return reject(403, "form")
    if headers.get("content-type", "").split(";")[0].strip().lower() != "application/x-www-form-urlencoded":
        return reject(415, "form")
    try:
        form = read_form(event, issuing)
    except ValueError:
        return reject(400, "form")
    locale = form["locale"]
    if form.get("website"):
        return reject(400, "form") if issuing else response(200, "saved", locale, origin)
    submitted = form.get("email", "").strip(" ")
    email = submitted.lower()
    if (
        not submitted.isascii() or len(email) > 254
        or len(email.split("@", 1)[0]) > 64 or not ADDRESS.fullmatch(email)
    ):
        return reject(422, "email")
    try:
        client = database()
        if issuing:
            return json_response(200, captcha.issue(client, email, locale), origin)
        if not captcha.verify(client, form.get("altcha", ""), email, locale):
            return reject(422, "retry")
        save(client, email, locale)
    except Exception:
        # SDK errors can include request data. Report only the failed operation.
        logging.error("Could not complete waitlist signup")
        return reject(503, "busy")
    return response(200, "saved", locale, origin)
