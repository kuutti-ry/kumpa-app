#!/usr/bin/env bash
# Generates Kuutti's two Telia Tunnistus keys (docs/vendors/telia.md; guide
# 2.1.1: RSA, one for signing, one for encryption) straight onto the offline
# medium, writes their public halves as the JWKs Telia is sent, and, with
# --put, loads the private halves into SSM (infra/README.md, Secrets). Nothing
# secret is printed or passed on a command line: the JWKs and their kids are
# public values, the same kids the API logs at boot under "bank identification".
#
#   infra/scripts/telia-keys.sh staging /Volumes/<offline-medium>
#   infra/scripts/telia-keys.sh staging /Volumes/<offline-medium> --put
#
# Writes to <offline-dir>: kuutti-<env>-telia-{sig,enc}.pem (private, mode 600),
# kuutti-<env>-telia-{sig,enc}.pub.pem, and kuutti-<env>-telia-jwks.json, the
# two public keys in the shape Telia asks for, which is what goes to
# id-maintenance@teliacompany.com. Refuses to overwrite a key: a Telia key is
# replaced by rotation (docs/runbooks/custody.md), never in place.
# Needs openssl and node; --put needs aws, signed in (pnpm aws:login).
# --self-test runs it against throwaway folders with a stand-in for aws, as
# CI's lint job does: no real medium, no AWS.
set -euo pipefail

if [ "${1:-}" = "--self-test" ]; then
  base=${TMPDIR:-/tmp}
  tmp=$(mktemp -d "${base%/}/telia-keys.XXXXXX") # named, so a folder left behind says whose it is
  trap 'rm -rf "$tmp"' EXIT
  self=$0
  fail() { echo "self-test failed: $*" >&2; exit 1; }
  sum() { openssl dgst -sha256 "$@" | sed 's/.*= //' | tr '\n' ' '; }
  # refuses <exit code> <what stderr says> <args...>
  refuses() {
    local code=$1 says=$2 got=0
    shift 2
    KUUTTI_TELIA_CONTACT= "$self" "$@" >"$tmp/out" 2>"$tmp/err" || got=$?
    [ "$got" = "$code" ] || fail "$* exited $got, not $code"
    grep -qF -- "$says" "$tmp/err" || fail "$* did not say: $says"
  }
  # holds <dir> <env> <name> <site> <contact> <redirect URIs...>: the files and
  # their modes, the metadata, the kids as RFC 7638 has them, 3072 bits, and no
  # private part in anything meant for Telia.
  holds() {
    local dir=$1 env=$2 use mode
    for use in sig enc; do
      mode=$(node -e 'console.log((require("node:fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$dir/kuutti-$env-telia-$use.pem")
      [ "$mode" = 600 ] || fail "$env $use.pem has mode $mode"
      [ "$(openssl pkey -in "$dir/kuutti-$env-telia-$use.pem" -pubout)" = "$(cat "$dir/kuutti-$env-telia-$use.pub.pem")" ] ||
        fail "$env $use.pub.pem is not the public half of $use.pem"
    done
    node - "$@" <<'EOF' || fail "$env metadata (above)"
const { readFileSync } = require("node:fs");
const { createHash, createPublicKey } = require("node:crypto");
const [dir, env, name, site, contact, ...redirects] = process.argv.slice(2);
const prefix = `${dir}/kuutti-${env}-telia`;
const client = JSON.parse(readFileSync(`${prefix}-client.json`, "utf8"));
const jwks = JSON.parse(readFileSync(`${prefix}-jwks.json`, "utf8"));
const wrong = [];
const want = (what, got, expected) => {
  if (JSON.stringify(got) !== JSON.stringify(expected)) wrong.push(`${what}: ${JSON.stringify(got)}, not ${JSON.stringify(expected)}`);
};
for (const field of ["client_name#fi", "client_name#sv", "client_name#en", "ftn_spname"]) want(field, client[field], name);
want("client_uri", client.client_uri, site);
want("redirect_uris", client.redirect_uris, redirects);
want("contacts", client.contacts, [contact]);
want("organization_name", client.organization_name, "Kuutti ry");
want("token_endpoint_auth_method", client.token_endpoint_auth_method, "private_key_jwt");
want("id_token encryption", [client.id_token_encrypted_response_alg, client.id_token_encrypted_response_enc], ["RSA-OAEP", "A128CBC-HS256"]);
want("client.json's keys", client.jwks, jwks);
want("uses", jwks.keys.map((k) => [k.use, k.alg]), [["sig", "RS256"], ["enc", "RSA-OAEP"]]);
for (const key of jwks.keys) {
  want(`${key.use} fields`, Object.keys(key).sort(), ["alg", "e", "kid", "kty", "n", "use"]);
  want(`${key.use} bits`, Buffer.from(key.n, "base64url").length * 8, 3072);
  const pem = createPublicKey(readFileSync(`${prefix}-${key.use}.pub.pem`)).export({ format: "jwk" });
  want(`${key.use} modulus`, key.n, pem.n);
  // RFC 7638 §3.2 written out by hand, not by the script's own code
  const thumbprint = createHash("sha256").update(`{"e":"${key.e}","kty":"RSA","n":"${key.n}"}`).digest("base64url");
  want(`${key.use} kid`, key.kid, thumbprint);
}
if (jwks.keys[0].kid === jwks.keys[1].kid) wrong.push("sig and enc are one key");
for (const file of ["client.json", "jwks.json"]) {
  if (/PRIVATE|"(d|p|q|dp|dq|qi)"/.test(readFileSync(`${prefix}-${file}`, "utf8"))) wrong.push(`${file} carries a private part`);
}
if (wrong.length) {
  console.error(wrong.join("\n"));
  process.exit(1);
}
EOF
  }

  mkdir "$tmp/bin" "$tmp/staging" "$tmp/prod" "$tmp/bare"
  printf '#!/bin/sh\nprintf "%%s\\n" "$*" >>"%s"\n' "$tmp/aws.log" >"$tmp/bin/aws"
  chmod +x "$tmp/bin/aws"
  KUUTTI_TELIA_CONTACT=a@example.org "$self" staging "$tmp/staging" >/dev/null || fail "staging exited $?"
  holds "$tmp/staging" staging Kuutti https://kuutti.app a@example.org https://api.staging.kuutti.app/auth/callback
  KUUTTI_TELIA_CONTACT=a@example.org "$self" prod "$tmp/prod" >/dev/null || fail "prod exited $?"
  holds "$tmp/prod" prod Kumpa https://kumpa.fi a@example.org https://api.kumpa.fi/auth/callback https://api.kuutti.app/auth/callback

  # A second run generates nothing; without a contact it keeps the metadata,
  # with one it writes the metadata again around the same keys.
  keys=$(sum "$tmp/staging"/*.pem)
  KUUTTI_TELIA_CONTACT= "$self" staging "$tmp/staging" >"$tmp/out" || fail "second staging run exited $?"
  grep -qF "generating nothing" "$tmp/out" || fail "a second run did not say it generates nothing"
  grep -qF "kept as it was" "$tmp/out" || fail "a second run without a contact did not keep the metadata"
  holds "$tmp/staging" staging Kuutti https://kuutti.app a@example.org https://api.staging.kuutti.app/auth/callback
  KUUTTI_TELIA_CONTACT=b@example.org "$self" staging "$tmp/staging" >/dev/null || fail "third staging run exited $?"
  holds "$tmp/staging" staging Kuutti https://kuutti.app b@example.org https://api.staging.kuutti.app/auth/callback
  [ "$(sum "$tmp/staging"/*.pem)" = "$keys" ] || fail "a run over existing keys changed them"

  # Without a contact on a fresh medium, the placeholder, and it says so.
  KUUTTI_TELIA_CONTACT= "$self" staging "$tmp/bare" >"$tmp/out" || fail "bare run exited $?"
  grep -qF "contacts is a placeholder" "$tmp/out" || fail "a placeholder contact went unmentioned"
  holds "$tmp/bare" staging Kuutti https://kuutti.app "<the association's mailbox>" https://api.staging.kuutti.app/auth/callback

  # --put hands aws the files by file://, under the environment's names, and
  # never --overwrite.
  PATH="$tmp/bin:$PATH" KUUTTI_TELIA_CONTACT= "$self" prod "$tmp/prod" --put >/dev/null || fail "--put exited $?"
  [ "$(cat "$tmp/aws.log")" = "ssm put-parameter --name /kuutti/prod/telia-signing-key --type SecureString --value file://$tmp/prod/kuutti-prod-telia-sig.pem
ssm put-parameter --name /kuutti/prod/telia-encryption-key --type SecureString --value file://$tmp/prod/kuutti-prod-telia-enc.pem" ] ||
    fail "--put called aws as: $(cat "$tmp/aws.log")"

  refuses 2 "environment must be staging or prod" production "$tmp/prod"
  refuses 2 "unknown argument --overwrite" prod "$tmp/prod" --overwrite
  refuses 2 "is not a directory" prod "$tmp/nowhere"
  refuses 1 "usage: telia-keys.sh" prod
  rm "$tmp/bare/kuutti-staging-telia-enc.pem"
  keys=$(sum "$tmp/bare/kuutti-staging-telia-sig.pem")
  refuses 3 "exists without the other" staging "$tmp/bare"
  [ ! -e "$tmp/bare/kuutti-staging-telia-enc.pem" ] && [ "$(sum "$tmp/bare/kuutti-staging-telia-sig.pem")" = "$keys" ] ||
    fail "a run over half a pair touched it"
  echo "self-test passed" >&2
  exit 0
fi

usage="usage: telia-keys.sh <staging|prod> <offline-dir> [--put]"
env="${1:?$usage}"
dir="${2:?$usage}"
put="${3:-}"
case "$env" in staging|prod) ;; *) echo "environment must be staging or prod" >&2; exit 2 ;; esac
case "$put" in ""|--put) ;; *) echo "unknown argument $put ($usage)" >&2; exit 2 ;; esac
[ -d "$dir" ] || { echo "$dir is not a directory; mount the offline medium first" >&2; exit 2; }
for tool in openssl node; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is not installed" >&2; exit 1; }
done
[ "$put" != "--put" ] || command -v aws >/dev/null 2>&1 || { echo "aws is not installed" >&2; exit 1; }

prefix="$dir/kuutti-$env-telia"

if [ ! -e "$prefix-sig.pem" ] && [ ! -e "$prefix-enc.pem" ]; then
  # 3072 bits: Telia's minimum is 2048. Private files are created readable by
  # the owner only; the public halves and the JWKs may be read by anyone.
  (
    umask 077
    for use in sig enc; do
      openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$prefix-$use.pem" 2>/dev/null
    done
  )
  for use in sig enc; do
    openssl pkey -in "$prefix-$use.pem" -pubout -out "$prefix-$use.pub.pem"
  done
  echo "generated $prefix-sig.pem and $prefix-enc.pem"
elif [ -e "$prefix-sig.pem" ] && [ -e "$prefix-enc.pem" ]; then
  echo "keys exist on $dir; writing their JWKs again, generating nothing"
else
  echo "one of $prefix-sig.pem and $prefix-enc.pem exists without the other; sort that out by hand" >&2
  exit 3
fi

# The JWKs as the guide's sample has them (2.3.1; the kid is the RFC 7638
# thumbprint, as in Telia's own Python sample, and the API computes the same
# from the private key, keyIdOf), and around them the client metadata in the
# shape of that sample's client.json: what "the protocol's metadata" of Telia's
# offer means for OIDC. Telia answers with the client_id. The redirect URIs are
# the ones envs/<env>/dns.tf gives the API; the contact is the association's
# mailbox (TD-4), from KUUTTI_TELIA_CONTACT so that no address is in the repo.
# Production registers both names from the start (ADR-072 §6) and shows the
# person Kumpa at the bank; the pre-production client keeps Kuutti and its one
# callback until the store reviews are through (the maintainer, 24/11/2026).
case "$env" in
  staging) redirect="https://api.staging.kuutti.app/auth/callback" name="Kuutti" site="https://kuutti.app" ;;
  prod) redirect="https://api.kumpa.fi/auth/callback https://api.kuutti.app/auth/callback" name="Kumpa" site="https://kumpa.fi" ;;
esac
# A metadata file that exists is kept when no contact is given, so a later
# run (--put, say) cannot replace a finished file with a placeholder.
keep_client=0
if [ -z "${KUUTTI_TELIA_CONTACT:-}" ] && [ -e "$prefix-client.json" ]; then keep_client=1; fi
node - "$prefix" "$redirect" "${KUUTTI_TELIA_CONTACT:-}" "$keep_client" "$name" "$site" <<'EOF'
const { createHash, createPublicKey } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const [prefix, redirects, contact, keepClient, name, site] = process.argv.slice(2);
const keys = ["sig", "enc"].map((use) => {
  const jwk = createPublicKey(readFileSync(`${prefix}-${use}.pub.pem`)).export({ format: "jwk" });
  const kid = createHash("sha256")
    .update(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n }))
    .digest("base64url");
  return { kty: jwk.kty, use, kid, alg: use === "sig" ? "RS256" : "RSA-OAEP", n: jwk.n, e: jwk.e };
});
const client = {
  organization_name: "Kuutti ry",
  contacts: [contact || "<the association's mailbox>"],
  "client_name#fi": name,
  "client_name#sv": name,
  "client_name#en": name,
  ftn_spname: name,
  client_uri: site,
  redirect_uris: redirects.split(" "),
  grant_types: ["authorization_code"],
  scope: "openid",
  require_signed_request_object: true,
  request_object_signing_alg: "RS256",
  token_endpoint_auth_method: "private_key_jwt",
  token_endpoint_auth_signing_alg: "RS256",
  id_token_signed_response_alg: "RS256",
  id_token_encrypted_response_alg: "RSA-OAEP",
  id_token_encrypted_response_enc: "A128CBC-HS256",
  jwks: { keys },
};
writeFileSync(`${prefix}-jwks.json`, `${JSON.stringify({ keys }, null, 2)}\n`);
if (keepClient !== "1") writeFileSync(`${prefix}-client.json`, `${JSON.stringify(client, null, 2)}\n`);
EOF
echo "for Telia: $prefix-client.json (the client metadata with both public keys; $prefix-jwks.json holds the keys alone)"
if [ "$keep_client" = 1 ]; then
  echo "  kept as it was: KUUTTI_TELIA_CONTACT is unset and the file exists"
elif [ -z "${KUUTTI_TELIA_CONTACT:-}" ]; then
  echo "  contacts is a placeholder: set KUUTTI_TELIA_CONTACT to the association's mailbox and run again, or edit the file"
fi
node -e 'for (const k of require(process.argv[1]).keys) console.log(`  ${k.use}  kid ${k.kid}`)' "$prefix-jwks.json"

if [ "$put" = "--put" ]; then
  # file:// keeps the key out of the shell history and the process list; no
  # --overwrite, so a second run cannot replace a key that is in use.
  aws ssm put-parameter --name "/kuutti/$env/telia-signing-key" --type SecureString --value "file://$prefix-sig.pem" >/dev/null
  aws ssm put-parameter --name "/kuutti/$env/telia-encryption-key" --type SecureString --value "file://$prefix-enc.pem" >/dev/null
  echo "stored /kuutti/$env/telia-signing-key and /kuutti/$env/telia-encryption-key"
else
  echo "the private keys stay on $dir; run again with --put, after pnpm aws:login, to load them into SSM"
fi
