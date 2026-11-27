import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time


LIFETIME_SECONDS = 600
MAX_NUMBER = 20_000


def binding(token, email, locale, salt):
    data = "\0".join((email, locale, salt)).encode("utf-8")
    return hmac.new(token.encode("ascii"), data, hashlib.sha256).hexdigest()


def work_hash(salt, number):
    return hashlib.sha256(f"{salt}{number}".encode("ascii")).hexdigest()


def issue(client, email, locale):
    # ALTCHA v1 wire format. An opaque token identifies the server-side challenge.
    token = secrets.token_urlsafe(32)
    salt = secrets.token_hex(16)
    challenge = work_hash(salt, secrets.randbelow(MAX_NUMBER + 1))
    client.put_item(
        TableName=os.environ["WAITLIST_CHALLENGES"],
        Item={
            "token": {"S": token},
            "binding": {"S": binding(token, email, locale, salt)},
            "challenge": {"S": challenge},
            "expiresAt": {"N": str(int(time.time()) + LIFETIME_SECONDS)},
        },
        ConditionExpression="attribute_not_exists(#token)",
        ExpressionAttributeNames={"#token": "token"},
    )
    return {"algorithm": "SHA-256", "challenge": challenge, "salt": salt,
            "maxnumber": MAX_NUMBER, "signature": token}


def verify(client, encoded, email, locale):
    if not isinstance(encoded, str) or not 0 < len(encoded) <= 768:
        return False
    try:
        proof = json.loads(base64.b64decode(encoded, validate=True).decode("utf-8"))
    except ValueError:
        return False
    if not isinstance(proof, dict):
        return False
    token = proof.get("signature")
    if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        return False

    # Returning the deleted row makes even concurrent attempts single use.
    issued = client.delete_item(
        TableName=os.environ["WAITLIST_CHALLENGES"],
        Key={"token": {"S": token}},
        ReturnValues="ALL_OLD",
    ).get("Attributes")
    if not issued or int(issued["expiresAt"]["N"]) <= time.time():
        return False

    number, salt = proof.get("number"), proof.get("salt")
    if (proof.get("algorithm") != "SHA-256" or type(number) is not int
            or not 0 <= number <= MAX_NUMBER or not isinstance(salt, str)
            or not re.fullmatch(r"[0-9a-f]{32}", salt)):
        return False
    expected = issued["challenge"]["S"]
    return (
        proof.get("challenge") == expected
        and hmac.compare_digest(expected, work_hash(salt, number))
        and hmac.compare_digest(issued["binding"]["S"], binding(token, email, locale, salt))
    )
