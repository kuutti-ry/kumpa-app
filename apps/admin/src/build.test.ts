// @vitest-environment node
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The panel as admin-deploy.yml ships it (ADR-025 §3): a production build
// against the staging API. The host's CSP allows scripts and styles from the
// host alone and images from the host and the API, so the page carries no
// inline script or style, nothing is inlined as a data: URL, and every file
// the page names is one of the build's. The page is read as a document, as a
// browser reads it (jsdom, no script run), never by matching its text.

const app = fileURLToPath(new URL("..", import.meta.url));
let outDir = "";
/** The built index.html, parsed; jsdom runs none of its scripts. */
let page: Document;
/** The emitted scripts and stylesheets, by file name under assets/. */
let emitted: Map<string, string>;

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "kuutti-admin-build-"));
  // Vitest runs with NODE_ENV=test, which would give a development React.
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VITE_API_URL", "https://api.staging.kuutti.app");
  try {
    await build({
      root: app,
      mode: "production",
      logLevel: "silent",
      build: { outDir, emptyOutDir: true },
    });
  } finally {
    vi.unstubAllEnvs();
  }
  page = new JSDOM(readFileSync(join(outDir, "index.html"), "utf8")).window.document;
  emitted = new Map(
    readdirSync(join(outDir, "assets"))
      .filter((name) => /\.(js|css)$/.test(name))
      .map((name) => [name, readFileSync(join(outDir, "assets", name), "utf8")]),
  );
}, 60_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe("the panel's build", () => {
  it("has no inline script, style or event handler on its page", () => {
    const scripts = [...page.querySelectorAll("script")];
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(script.getAttribute("src")).toBeTruthy();
      expect(script.textContent?.trim()).toBe("");
    }
    expect(page.querySelectorAll("style")).toHaveLength(0);
    const inline = [...page.querySelectorAll("*")]
      .flatMap((element) => [...element.attributes].map((attribute) => attribute.name))
      .filter((name) => name === "style" || name.startsWith("on"));
    expect(inline).toEqual([]);
  });

  it("names every file of its page under its assets, and each is there", () => {
    const references = [...page.querySelectorAll("[src], [href]")].map(
      (element) => element.getAttribute("src") ?? element.getAttribute("href") ?? "",
    );
    expect(references).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\.js$/),
        expect.stringMatching(/\.css$/),
        expect.stringMatching(/\/favicon-[\w-]+\.png$/),
      ]),
    );
    for (const url of references) {
      expect(url).toMatch(/^\/assets\/[^/]+$/);
      expect(existsSync(join(outDir, url))).toBe(true);
    }
  });

  it("inlines nothing as a data: URL, and its scripts name the logo under its assets", () => {
    const code = [...emitted.values()].join("\n");
    expect(code).not.toMatch(/data:[a-z]+\/[\w.+-]+[;,]/i);
    const logo = readdirSync(join(outDir, "assets")).find((name) => name.startsWith("logo-mark-"));
    expect(logo).toMatch(/\.png$/);
    expect(code).toContain(`/assets/${logo}`);
  });

  it("writes the bundled packages' licences at its root, which its footer links (#416)", () => {
    const licences = readFileSync(join(outDir, "licenses.txt"), "utf8");
    for (const name of [
      "react",
      "react-dom",
      "react-router",
      "zod",
      "i18next",
      "intl-messageformat",
      // shadcn/ui's runtime (ADR-050).
      "class-variance-authority",
      "clsx",
      "tailwind-merge",
      "lucide-react",
    ]) {
      expect(licences).toMatch(new RegExp(`^## ${name} - \\d`, "m"));
    }
    expect(licences).toContain("Copyright (c) Meta Platforms, Inc. and affiliates.");
    expect(licences).toContain(
      "Redistribution and use of this software in source and binary forms",
    );
    // Our own packages are the repository's licence, not a third party's.
    expect(licences).not.toMatch(/^## @kuutti\//m);
    expect([...emitted.values()].join("\n")).toContain("/licenses.txt");
  });

  it("ships one stylesheet, Tailwind's, which keeps its licence line and names Saiga's faces and no image (ADR-050, ADR-052)", () => {
    const sheets = [...emitted.keys()].filter((name) => name.endsWith(".css"));
    expect(sheets).toHaveLength(1);
    const css = emitted.get(sheets[0] ?? "") ?? "";
    // The preflight and utilities are Tailwind's, under MIT: the notice travels with them.
    expect(css).toMatch(
      /^\/\*! tailwindcss v4\.\d+\.\d+ \| MIT License \| https:\/\/tailwindcss\.com \*\//,
    );
    // The CSP's font-src 'self' takes Saiga's faces from the origin's root,
    // where the maintainer puts them (ADR-052). Nothing else a stylesheet
    // names, and no image (default-src 'none').
    expect(css.match(/@font-face/g)).toHaveLength(4);
    expect([...css.matchAll(/url\(([^)]*)\)/g)].map(([, url]) => url)).toEqual(
      ["Regular", "Italic", "Medium", "Bold"].map(
        (face) => `/fonts/saiga-1.002/Saiga-${face}.woff2`,
      ),
    );
  });
});
