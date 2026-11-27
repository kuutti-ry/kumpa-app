// An answer of the API as this build reads it (#745, ADR-003 History). Most
// contracts are strict and the API's tests hold its answers to them, but a
// build on a phone is older than the API it talks to: a key the API added since
// is one this build does not know. It is left out, never a failure, so that a
// field added to an answer breaks none of the builds people have installed.
// Anything else outside the contract fails as the contract's own parse says.

/** One of zod's issues, as far as this reader looks at it. */
type Issue = { code: string; path: readonly PropertyKey[]; keys?: readonly string[] };

/** What a contract's `safeParse` answers. */
type Parsed<T> =
  | { success: true; data: T }
  | { success: false; error: Error & { issues: readonly Issue[] } };

/** A contract of `@kuutti/schema`, as far as this reader needs one. */
type Contract<T> = { safeParse(data: unknown): Parsed<T> };

/** The answer as the contract's `safeParse` reads it, less the keys this build does not know. */
export function readAnswerSafely<T>(contract: Contract<T>, data: unknown): Parsed<T> {
  const read = contract.safeParse(data);
  if (read.success) return read;
  // shortcut: under a plain z.union of objects, zod reports the one option that
  // failed only on keys it does not know, and the answer is read as that option,
  // even where another option declares such a key with a value it refuses; two
  // such options come back inside invalid_union and still fail. No answer the
  // app reads has such a union (ServerFrame's and Notice's are discriminated,
  // which report their own option's keys); leaving out only the keys that no
  // option declares would lift it.
  const { issues } = read.error;
  if (!issues.every((issue) => issue.code === "unrecognized_keys")) return read;
  const known = issues.reduce<unknown>(
    (value, issue) => without(value, issue.path, issue.keys ?? []),
    data,
  );
  return contract.safeParse(known);
}

/** The answer as the contract's `parse` reads it, less the keys this build does not know; throws what `parse` throws. */
export function readAnswer<T>(contract: Contract<T>, data: unknown): T {
  const read = readAnswerSafely(contract, data);
  if (!read.success) throw read.error;
  return read.data;
}

/** `value` without `keys` in the object at `path`: copied on the way down, never changed in place. */
function without(value: unknown, path: readonly PropertyKey[], keys: readonly string[]): unknown {
  if (typeof value !== "object" || value === null) return value;
  const [step, ...rest] = path;
  if (Array.isArray(value)) {
    return value.map((item, index) => (index === step ? without(item, rest, keys) : item));
  }
  if (step === undefined) {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
  }
  return { ...value, [step]: without((value as Record<PropertyKey, unknown>)[step], rest, keys) };
}
