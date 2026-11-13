import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { historyFixture } from "./history-fixture.js";
test("GitOps restores raw or compressed private history without printing payloads", () => {
  const archive = JSON.stringify(historyFixture());
  for (const data of [
    archive,
    "gzip:" + gzipSync(archive).toString("base64"),
  ]) {
    const dir = mkdtempSync(join(tmpdir(), "dayoff-restore-"));
    try {
      const result = spawnSync(
        process.execPath,
        [resolve("scripts/restore-ci.mjs")],
        {
          cwd: dir,
          encoding: "utf8",
          env: {
            RUNNER_TEMP: dir,
            DAYOFF_CONFIG_JSON: "{}",
            CLASP_AUTH_JSON: "{}",
            CLASP_PROJECT_JSON: "{}",
            DAYOFF_DEPLOYMENT_ID: "example",
            DAYOFF_HISTORY_JSON: data,
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(
        JSON.parse(
          readFileSync(join(dir, "local/attendance-history.json"), "utf8"),
        ),
        JSON.parse(archive),
      );
      assert.match(
        readFileSync(join(dir, ".env"), "utf8"),
        /DAYOFF_HISTORY=local\/attendance-history.json/,
      );
      assert.doesNotMatch(result.stdout, /fy2027.xlsx|<b>V/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
