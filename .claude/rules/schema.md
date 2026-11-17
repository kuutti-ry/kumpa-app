---
paths:
  - "packages/schema/**"
---

# Shared schema (zod) rules

Consult `https://zod.dev/llms.txt`. This package is the single source of contracts: route inputs and outputs.

- Every route contract is a zod schema exported from here and used by the API, the mobile app, and the admin panel. No app keeps its own copy.
- Schemas are strict: unknown keys rejected on input, explicit `.max()` on strings and arrays, enums for closed sets, branded ids where confusion is possible (`PhotoId` is the one today).
- Response schemas never include like counts (a person's own likes left today aside, #524), exposure counts, desirability metrics, `hetu_hmac`, or another user's `account_id` beyond what the card needs.
- Gender counts in any export schema apply the k >= 10 suppression rule. The pond counter's number and bands apply the same floor (`POND_COUNTER_K_MIN`).
- Keep this package dependency-free apart from zod; React Native imports it.
