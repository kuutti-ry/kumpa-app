import base64
import json
import unittest
from datetime import datetime, timedelta
from unittest.mock import Mock, patch
from urllib.parse import urlencode

import handler


def request(locale="en", email="Visitor+News@example.org", *, route="/join"):
    return {
        "version": "2.0",
        "routeKey": f"POST {route}",
        "requestContext": {"http": {"method": "POST"}},
        "headers": {
            "content-type": "application/x-www-form-urlencoded",
            "origin": "https://kumpa.fi",
        },
        "body": urlencode({"email": email, "locale": locale, "website": ""}),
        "isBase64Encoded": False,
    }


def answer_request(locale="en", email="Visitor+News@example.org"):
    event = request(locale, email)
    event["body"] = urlencode({"locale": locale, "email": email, "altcha": "solution"})
    return event


class ConditionalCheckFailedException(Exception):
    pass


class WaitlistTests(unittest.TestCase):
    def setUp(self):
        self.db = Mock()
        self.db.exceptions.ConditionalCheckFailedException = ConditionalCheckFailedException
        self.enterContext(patch.object(handler, "database", return_value=self.db))
        self.enterContext(patch.dict("os.environ", {"WAITLIST_TABLE": "test-list"}))
        self.issue = self.enterContext(patch.object(handler.captcha, "issue", return_value={"algorithm": "SHA-256", "signature": "opaque"}))
        self.verify = self.enterContext(patch.object(handler.captcha, "verify", return_value=True))

    def test_private_signup(self):
        event = request(email="Visitor&Co@example.org", route="/challenge")
        event["headers"]["origin"] = "https://kuutti.app"
        event["body"] = base64.b64encode(event["body"].encode()).decode()
        event["isBase64Encoded"] = True
        result = handler.handler(event, None)
        self.assertEqual(200, result["statusCode"])
        self.assertEqual(json.loads(result["body"]), {"algorithm": "SHA-256", "signature": "opaque"})
        self.assertNotIn("@example.org", str(result))
        self.assertEqual("https://kuutti.app", result["headers"]["Access-Control-Allow-Origin"])
        self.assertEqual("Origin", result["headers"]["Vary"])
        self.assertNotIn("Access-Control-Allow-Credentials", result["headers"])
        self.assertEqual("no-store", result["headers"]["Cache-Control"])
        self.issue.assert_called_once_with(self.db, "visitor&co@example.org", "en")
        self.verify.assert_not_called()
        self.db.put_item.assert_not_called()

        result = handler.handler(answer_request(email="Visitor&Co@example.org"), None)
        self.verify.assert_called_once_with(self.db, "solution", "visitor&co@example.org", "en")
        self.assertEqual(200, result["statusCode"])
        self.assertIn('<html lang="en">', result["body"])
        self.assertNotIn("@example.org", str(result))
        self.assertEqual("no-store", result["headers"]["Cache-Control"])
        args = self.db.put_item.call_args.kwargs
        self.assertEqual("test-list", args["TableName"])
        self.assertEqual("attribute_not_exists(#email) OR #expiry <= :now", args["ConditionExpression"])
        row = args["Item"]
        self.assertEqual({"email", "locale", "createdAt", "expiresAt", "consentVersion"}, set(row))
        self.assertEqual({"S": "visitor&co@example.org"}, row["email"])
        self.assertEqual({"S": "en"}, row["locale"])
        self.assertEqual({"S": "launch-v1"}, row["consentVersion"])
        created = datetime.fromisoformat(row["createdAt"]["S"])
        self.assertEqual(int((created + timedelta(days=365)).timestamp()), int(row["expiresAt"]["N"]))
        self.assertEqual(str(int(created.timestamp())), args["ExpressionAttributeValues"][":now"]["N"])

    def test_existing_address_and_honeypot_have_the_same_reply(self):
        event = answer_request(locale="fi")
        result = handler.handler(event, None)
        self.assertIn('<html lang="fi">', result["body"])
        self.db.put_item.side_effect = ConditionalCheckFailedException()
        self.assertEqual(result, handler.handler(event, None))
        self.db.reset_mock()
        event = request(locale="fi")
        event["body"] = urlencode({"locale": "fi", "email": "example", "website": "bot"})
        self.assertEqual(result, handler.handler(event, None))
        self.db.put_item.assert_not_called()

    def test_cannot_skip_challenge(self):
        self.verify.return_value = False
        for event in [request(), answer_request()]:
            result = handler.handler(event, None)
            self.assertEqual(422, result["statusCode"])
            self.assertIn("Please try signing up again", result["body"])
            self.assertNotIn("@example.org", result["body"])
        self.db.put_item.assert_not_called()
        self.issue.assert_not_called()

    def test_issues_challenge_from_every_public_site_origin(self):
        for origin in ["https://kumpa.fi", "https://www.kumpa.fi", "https://kuutti.app", "https://www.kuutti.app"]:
            with self.subTest(origin=origin):
                event = request(route="/challenge")
                event["headers"]["origin"] = origin
                result = handler.handler(event, None)
                self.assertEqual(200, result["statusCode"])
                self.assertEqual(origin, result["headers"]["Access-Control-Allow-Origin"])
        self.assertEqual(4, self.issue.call_count)
        self.db.put_item.assert_not_called()

    def test_rejects_originless_or_foreign_submissions(self):
        for route in ["/join", "/challenge"]:
            for origin in [None, "null", "https://waitlist.kumpa.fi", "https://kumpa.fi.invalid", "https://www.kuutti.app:80"]:
                with self.subTest(origin=origin, route=route):
                    event = request(route=route)
                    if origin:
                        event["headers"]["origin"] = origin
                    else:
                        del event["headers"]["origin"]
                    result = handler.handler(event, None)
                    self.assertEqual(403, result["statusCode"])
                    self.assertNotIn("Access-Control-Allow-Origin", result["headers"])
        self.db.put_item.assert_not_called()
        self.issue.assert_not_called()

    def test_challenge_rejections_can_be_read_by_the_site(self):
        for fields, status in [({"locale":"en","website":"bot"}, 400), ({"locale":"en","email":"bad"}, 422)]:
            event = request(route="/challenge")
            event["body"] = urlencode(fields)
            result = handler.handler(event, None)
            self.assertEqual(status, result["statusCode"])
            self.assertIn("error", json.loads(result["body"]))
            self.assertEqual("https://kumpa.fi", result["headers"]["Access-Control-Allow-Origin"])
        self.issue.assert_not_called()

    def test_invalid_email(self):
        for email in ["", "missing-domain", "x@localhost", "a..b@example.org", "x@-invalid.org",
                      "x@example.org\n", "K@example.org", "a" * 65 + "@example.org"]:
            with self.subTest(email=email):
                result = handler.handler(request(email=email), None)
                self.assertEqual(422, result["statusCode"])
                self.assertIn("Check your email address", result["body"])
        self.db.put_item.assert_not_called()

    def test_invalid_forms_and_protocol(self):
        self.assertEqual(404, handler.handler(request(route="/elsewhere"), None)["statusCode"])
        event = request()
        event["requestContext"]["http"]["method"] = "GET"
        self.assertEqual(405, handler.handler(event, None)["statusCode"])
        event = request()
        event["headers"]["content-type"] = "application/json"
        self.assertEqual(415, handler.handler(event, None)["statusCode"])
        for body in ["locale=fi&locale=en&email=x%40example.org", "email=x%40example.org&locale=xx",
                     "locale=en&email=x%40example.org&x=1", "locale=en&email=%FF", "x" * 3000]:
            with self.subTest(body=body[:45]):
                event = request()
                event["body"] = body
                self.assertEqual(400, handler.handler(event, None)["statusCode"])
        event = request()
        event.update(body="!!!", isBase64Encoded=True)
        self.assertEqual(400, handler.handler(event, None)["statusCode"])
        self.db.put_item.assert_not_called()

    def test_write_failure_gives_retryable_error_without_email(self):
        self.db.put_item.side_effect = RuntimeError("visitor+news@example.org")
        with self.assertLogs(level="ERROR") as logs:
            result = handler.handler(answer_request(), None)
        self.assertEqual(503, result["statusCode"])
        self.assertNotIn("@example.org", str(result) + str(logs.output))
        self.assertIn("try again", result["body"])


if __name__ == "__main__":
    unittest.main()
