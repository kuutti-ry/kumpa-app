import base64
import hashlib
import json
import unittest
from unittest.mock import Mock, patch

import captcha


EMAIL = "reader@example.org"


class ChallengeTests(unittest.TestCase):
    def setUp(self):
        self.rows = {}
        self.client = Mock()
        self.client.put_item.side_effect = self.put
        self.client.delete_item.side_effect = self.delete
        self.enterContext(patch.dict("os.environ", {"WAITLIST_CHALLENGES": "test-challenges"}))
        self.now = self.enterContext(patch.object(captcha.time, "time", return_value=1000))

    def put(self, *, TableName, Item, ConditionExpression, ExpressionAttributeNames):
        self.assertEqual("test-challenges", TableName)
        self.assertEqual("attribute_not_exists(#token)", ConditionExpression)
        self.assertEqual({"#token": "token"}, ExpressionAttributeNames)
        token = Item["token"]["S"]
        self.assertNotIn(token, self.rows)
        self.rows[token] = Item

    def delete(self, *, TableName, Key, ReturnValues):
        self.assertEqual("test-challenges", TableName)
        self.assertEqual("ALL_OLD", ReturnValues)
        row = self.rows.pop(Key["token"]["S"], None)
        return {"Attributes": row} if row else {}

    def issue(self, number=8):
        with patch.object(captcha.secrets, "randbelow", return_value=number):
            return captcha.issue(self.client, EMAIL, "en")

    def payload(self, issued, number=8, **changes):
        proof = {key: issued[key] for key in ("algorithm", "challenge", "salt", "signature")}
        proof.update(number=number, **changes)
        return base64.b64encode(json.dumps(proof).encode()).decode()

    def test_v1_challenge_and_single_use(self):
        for number in [0, 8, captcha.MAX_NUMBER]:
            issued = self.issue(number)
            self.assertEqual(set(issued), {"algorithm", "challenge", "salt", "signature", "maxnumber"})
            self.assertEqual(issued["algorithm"], "SHA-256")
            self.assertEqual(issued["maxnumber"], captcha.MAX_NUMBER)
            self.assertEqual(hashlib.sha256((issued["salt"] + str(number)).encode()).hexdigest(), issued["challenge"])
            self.assertRegex(issued["salt"], r"^[0-9a-f]{32}$")
            self.assertRegex(issued["signature"], r"^[A-Za-z0-9_-]{43}$")
            encoded = self.payload(issued, number)
            self.assertTrue(captcha.verify(self.client, encoded, EMAIL, "en"))
            self.assertFalse(captcha.verify(self.client, encoded, EMAIL, "en"))

    def test_invalid_attempts_consume_token(self):
        for changes, email, locale in [
            ({"number": 7}, EMAIL, "en"), ({"number": -1}, EMAIL, "en"),
            ({"number": captcha.MAX_NUMBER+1}, EMAIL, "en"), ({"number": True}, EMAIL, "en"),
            ({"number": "8"}, EMAIL, "en"), ({"number": None}, EMAIL, "en"),
            ({"algorithm": "SHA-1"}, EMAIL, "en"), ({"salt": "x"}, EMAIL, "en"),
            ({"salt": "f"*32}, EMAIL, "en"), ({"challenge": "0"*64}, EMAIL, "en"),
            ({}, EMAIL, "fi"), ({}, "another@example.org", "en"),
        ]:
            with self.subTest(changes=changes, email=email, locale=locale):
                issued = self.issue()
                encoded = self.payload(issued, **changes)
                self.assertFalse(captcha.verify(self.client, encoded, email, locale))
                self.assertFalse(captcha.verify(self.client, self.payload(issued), EMAIL, "en"))

    def test_cannot_mint_easier_challenge(self):
        issued = self.issue()
        own_salt = "c" * 32
        own_hash = hashlib.sha256((own_salt + "0").encode()).hexdigest()
        self.assertFalse(captcha.verify(
            self.client, self.payload(issued, 0, salt=own_salt, challenge=own_hash), EMAIL, "en"
        ))

    def test_expiry_applies_even_before_dynamodb_removes_row(self):
        issued = self.issue()
        self.now.return_value += captcha.LIFETIME_SECONDS
        self.assertFalse(captcha.verify(self.client, self.payload(issued), EMAIL, "en"))
        self.assertNotIn(issued["signature"], self.rows)

    def test_each_challenge_has_its_own_digests_and_no_address(self):
        first = self.issue()
        second = self.issue()
        self.assertNotEqual(first["salt"], second["salt"])
        self.assertNotEqual(first["challenge"], second["challenge"])
        self.assertNotIn(EMAIL, repr(self.rows) + repr(first) + repr(second))
        self.assertNotEqual(self.rows[first["signature"]]["binding"], self.rows[second["signature"]]["binding"])

    def test_bad_proofs_skip_database(self):
        def encode(value):
            return base64.b64encode(json.dumps(value).encode()).decode()

        for proof in [None, "", "!", "x"*769, encode([]), encode({}), encode({"signature": "!"*43})]:
            self.assertFalse(captcha.verify(self.client, proof, EMAIL, "en"))
        self.client.delete_item.assert_not_called()


if __name__ == "__main__":
    unittest.main()
