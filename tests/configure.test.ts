import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const script = resolve("scripts/configure.ts");
const example = JSON.parse(readFileSync("config/example.json", "utf8"));
function run(args: string[], cwd: string, extra: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: { ...process.env, DAYOFF_CONFIG: "", ...extra },
    encoding: "utf8",
  });
}
test("calendar setup changes only the private calendar ID and is repeatable", () => {
  const dir = mkdtempSync(join(tmpdir(), "dayoff-config-")),
    file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({ ...example, displayName: "Existing employee" }),
  );
  const args = [
    "--config",
    file,
    "--calendar-id",
    "staff@example.calendar.google.com",
  ];
  for (let i = 0; i < 2; i++) assert.equal(run(args, dir).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
    ...example,
    displayName: "Existing employee",
    calendarId: "staff@example.calendar.google.com",
  });
  assert.equal(statSync(file).mode & 0o777, 0o600);
});
test("dry run creates no files and invalid calendar input fails before writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "dayoff-config-")),
    file = join(dir, "private", "config.json");
  assert.equal(
    run(
      [
        "--config",
        file,
        "--calendar-id",
        "staff@example.calendar.google.com",
        "--dry-run",
      ],
      dir,
    ).status,
    0,
  );
  assert.equal(existsSync(file), false);
  const invalid = run(
    ["--config", file, "--calendar-id", "https://calendar.google.com/secret"],
    dir,
  );
  assert.notEqual(invalid.status, 0);
  assert.equal(existsSync(file), false);
  assert.doesNotMatch(invalid.stderr, /secret/);
});
test("configuration follows the environment and data-only .env path", () => {
  const dir = mkdtempSync(join(tmpdir(), "dayoff-config-")),
    file = join(dir, "chosen.json");
  writeFileSync(file, JSON.stringify(example));
  writeFileSync(join(dir, ".env"), "DAYOFF_CONFIG=chosen.json\n");
  assert.equal(
    run(["--calendar-id", "staff@example.calendar.google.com"], dir).status,
    0,
  );
  assert.equal(
    JSON.parse(readFileSync(file, "utf8")).calendarId,
    "staff@example.calendar.google.com",
  );
  assert.notEqual(run(["--calendar-id"], dir).status, 0);
});
