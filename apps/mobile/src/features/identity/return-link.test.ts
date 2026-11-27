import fc from "fast-check";
import { signInReturnPath } from "./return-link";

// The bank login's return on its verified https link (#184, ADR-074 §2):
// `/auth/return` on one of the API's hosts becomes the app's own `/auth`,
// query and all, and nothing else is touched.

const CODE = `${"aZ09_-".repeat(7)}Q`;

describe("the bank login's return on the verified link", () => {
  it.each([
    ["production", "https://api.kumpa.fi"],
    ["production's old name", "https://api.kuutti.app"],
    ["staging", "https://api.staging.kumpa.fi"],
    ["staging's old name", "https://api.staging.kuutti.app"],
    ["a host in capitals", "HTTPS://API.KUMPA.FI"],
    ["a host with a port", "https://api.kumpa.fi:443"],
  ])("is the sign-in's screen with the code, from %s", (_what, origin) => {
    expect(signInReturnPath(`${origin}/auth/return?code=${CODE}`)).toBe(`/auth?code=${CODE}`);
  });

  it.each([
    ["the whole query", "?code=abc&state=x%20y&code=def", "/auth?code=abc&state=x%20y&code=def"],
    ["a refusal's code", "?error=auth_code_used", "/auth?error=auth_code_used"],
    ["an empty query", "?", "/auth?"],
    ["no query", "", "/auth"],
    ["the query without a fragment", "?code=abc#frag?code=other", "/auth?code=abc"],
    ["nothing of a fragment alone", "#code=abc", "/auth"],
  ])("keeps %s", (_what, rest, path) => {
    expect(signInReturnPath(`https://api.kumpa.fi/auth/return${rest}`)).toBe(path);
  });

  it.each([
    ["the scheme's return", "fi.kumpa://auth?code=abc"],
    ["the scheme's stale path", "fi.kumpa://auth/return"],
    ["plain http", "http://api.kumpa.fi/auth/return?code=abc"],
    ["the bank's callback", "https://api.kumpa.fi/auth/callback?code=abc&state=x"],
    ["a longer path", "https://api.kumpa.fi/auth/return/more?code=abc"],
    ["a slash after it", "https://api.kumpa.fi/auth/return/?code=abc"],
    ["a longer last segment", "https://api.kumpa.fi/auth/returned?code=abc"],
    ["the path further down", "https://api.kumpa.fi/x/auth/return?code=abc"],
    ["the path in a query", "https://api.kumpa.fi/?next=/auth/return?code=abc"],
    ["the path in a fragment", "https://api.kumpa.fi/#/auth/return?code=abc"],
    ["an invitation's link", "https://api.kumpa.fi/i/ABCDE-FGHJK"],
    [
      "a return carried in the scheme's query",
      "fi.kumpa://auth?next=https://api.kumpa.fi/auth/return?code=abc",
    ],
    ["a return with words before it", "see https://api.kumpa.fi/auth/return?code=abc"],
    ["no host", "https:///auth/return?code=abc"],
    ["a path without a host", "/auth/return?code=abc"],
    ["an app's own path", "/auth?code=abc"],
    ["nothing", ""],
  ])("leaves %s as it came", (_what, link) => {
    expect(signInReturnPath(link)).toBe(link);
  });

  it("gives any host's return the same query on /auth, and never an address of its own making", () => {
    const host = fc.stringMatching(/^[a-z0-9][a-z0-9.-]{0,40}(:[0-9]{1,5})?$/);
    const query = fc.stringMatching(/^[A-Za-z0-9_=&%.~+-]{0,80}$/);
    fc.assert(
      fc.property(host, query, (name, rest) => {
        expect(signInReturnPath(`https://${name}/auth/return?${rest}`)).toBe(`/auth?${rest}`);
      }),
      { seed: 184, numRuns: 300 },
    );
    const anything = fc.oneof(
      fc.string({ maxLength: 120 }),
      fc.webUrl({ withQueryParameters: true, withFragments: true }),
      fc.webUrl().map((url) => `${url}/auth/return?code=abc`),
    );
    fc.assert(
      fc.property(anything, (link) => {
        const path = signInReturnPath(link);
        // Either untouched, or the sign-in's screen with a query and no host or fragment.
        if (path !== link) expect(path).toMatch(/^\/auth(\?[^#]*)?$/);
      }),
      { seed: 184, numRuns: 500 },
    );
  });
});
