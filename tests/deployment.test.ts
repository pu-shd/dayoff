import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("deployment prints the canonical Google URL rather than constructing a generic route", () => {
  const script = readFileSync("scripts/deploy.sh", "utf8");
  assert.doesNotMatch(script, /https:\/\/script\.google\.com\/macros\/s\//);
  assert.match(script, /resolve-deployment/);
});

import { webAppUrl } from "../src/deployment.js";
function metadata(url: string, access = "MYSELF") {
  return {
    entryPoints: [
      {
        entryPointType: "WEB_APP",
        webApp: {
          url,
          entryPointConfig: { access, executeAs: "USER_DEPLOYING" },
        },
      },
    ],
  };
}
test("Workspace domain-specific URLs are preserved exactly", () => {
  const url =
    "https://script.google.com/a/macros/example.edu/s/deployment-id/exec";
  assert.equal(webAppUrl(metadata(url)), url);
});
test("consumer account URLs remain valid without inventing a domain", () => {
  const url = "https://script.google.com/macros/s/deployment-id/exec";
  assert.equal(webAppUrl(metadata(url)), url);
});
test("verification fails explicitly for missing entry points or widened access", () => {
  assert.throws(() => webAppUrl({ entryPoints: [] }), /No web app URL/);
  assert.throws(
    () =>
      webAppUrl(
        metadata("https://script.google.com/macros/s/id/exec", "ANYONE"),
      ),
    /owner-only/,
  );
  assert.throws(
    () => webAppUrl(metadata("https://example.org/exec")),
    /Invalid Google/,
  );
});
