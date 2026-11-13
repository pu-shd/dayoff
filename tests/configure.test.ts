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

test("management setup replaces recipients without changing calendar or delivery", () => {
  const dir = mkdtempSync(join(tmpdir(), "dayoff-config-")),
    file = join(dir, "config.json");
  const initial = {
    ...example,
    calendarId: "existing@example.calendar.google.com",
  };
  writeFileSync(file, JSON.stringify(initial));
  const args = [
    "--config",
    file,
    "--management-email",
    "manager1@example.edu",
    "--management-email",
    "manager2@example.edu",
  ];
  for (let i = 0; i < 2; i++) assert.equal(run(args, dir).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
    ...initial,
    managementEmails: ["manager1@example.edu", "manager2@example.edu"],
  });
});
test("invalid management recipients fail before changing configuration or exposing inputs", () => {
  const dir = mkdtempSync(join(tmpdir(), "dayoff-config-")),
    file = join(dir, "config.json");
  const original = JSON.stringify(example);
  writeFileSync(file, original);
  const result = run(
    ["--config", file, "--management-email", "private-invalid-address"],
    dir,
  );
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(file, "utf8"), original);
  assert.doesNotMatch(result.stderr, /private-invalid-address/);
  assert.notEqual(
    run(
      [
        "--config",
        file,
        "--management-email",
        "same@example.edu",
        "--management-email",
        "same@example.edu",
      ],
      dir,
    ).status,
    0,
  );
});
test("calendar and management settings can be configured together without writing on dry run", () => {
  const dir = mkdtempSync(join(tmpdir(), "dayoff-config-")),
    file = join(dir, "new", "config.json");
  const args = [
    "--config",
    file,
    "--calendar-id",
    "staff@example.calendar.google.com",
    "--management-email",
    "manager@example.edu",
  ];
  assert.equal(run([...args, "--dry-run"], dir).status, 0);
  assert.equal(existsSync(file), false);
  assert.equal(run(args, dir).status, 0);
  const c = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(c.calendarId, "staff@example.calendar.google.com");
  assert.deepEqual(c.managementEmails, ["manager@example.edu"]);
  assert.equal(c.delivery, "disabled");
});

test("fiscal-year start is configurable through setup and invalid dates never overwrite settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "dayoff-config-")),
    file = join(dir, "config.json");
  writeFileSync(file, JSON.stringify(example));
  assert.equal(
    run(["--config", file, "--fiscal-year-start", "10-01"], dir).status,
    0,
  );
  const saved = readFileSync(file, "utf8");
  assert.equal(JSON.parse(saved).fiscalYearStart, "10-01");
  assert.notEqual(
    run(["--config", file, "--fiscal-year-start", "02-30"], dir).status,
    0,
  );
  assert.equal(readFileSync(file, "utf8"), saved);
});

test("holiday files replace the private dates and support safe repeatable dry runs", () => {
  const dir = mkdtempSync(join(tmpdir(), "dayoff-holidays-")),
    file = join(dir, "config.json"),
    holidays = join(dir, "holidays.json");
  writeFileSync(file, JSON.stringify(example));
  writeFileSync(holidays, JSON.stringify(["2026-11-26", "2026-11-27"]));
  const args = ["--config", file, "--holidays-file", holidays];
  assert.equal(run([...args, "--dry-run"], dir).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).holidays, []);
  for (let i = 0; i < 2; i++) assert.equal(run(args, dir).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
    ...example,
    holidays: ["2026-11-26", "2026-11-27"],
  });
  for (const values of [
    ["2026-02-30"],
    ["2026-11-26", "2026-11-26"],
    ["2028-11-26"],
  ]) {
    writeFileSync(holidays, JSON.stringify(values));
    const before = readFileSync(file, "utf8");
    assert.notEqual(run(args, dir).status, 0);
    assert.equal(readFileSync(file, "utf8"), before);
  }
});
