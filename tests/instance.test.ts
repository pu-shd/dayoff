import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  loadInstance,
  prepareInstance,
  runInstance,
  type Command,
} from "../scripts/instance.js";
import { readFileSync as read } from "node:fs";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dayoff-instance-")),
    source = join(root, "sources/workbooks");
  mkdirSync(source, { recursive: true });
  const workbook = Buffer.from("PK fixture workbook");
  writeFileSync(join(source, "fy2027 example.xlsx"), workbook);
  const config = JSON.parse(read("config/example.json", "utf8"));
  const target = {
    scriptId: "example-script-id-1234567890",
    deploymentId: "example-deployment-id-1234567890",
    webAppUrl:
      "https://script.google.com/macros/s/example-deployment-id-1234567890/exec",
  };
  const definition = {
    version: 1,
    configFile: "config.json",
    sourceDirectory: "sources/workbooks",
    inventoryFile: "sources/inventory.json",
    targetFile: "target.json",
    anchorFiscalYear: 2027,
  };
  for (const [name, data] of Object.entries({
    "config.json": config,
    "target.json": target,
    "instance.json": definition,
    "app.lock.json": {
      repository: "https://github.com/example/dayoff.git",
      revision: "a".repeat(40),
    },
    "sources/inventory.json": [
      {
        fiscalYear: 2027,
        name: "fy2027 example.xlsx",
        sha256: createHash("sha256").update(workbook).digest("hex"),
      },
    ],
  }))
    writeFileSync(join(root, name), JSON.stringify(data));
  return { root, source, target };
}
test("private instance validation detects changed sources and path traversal", () => {
  const { root, source } = fixture();
  try {
    assert.equal(loadInstance(root).sources.length, 1);
    writeFileSync(join(source, "fy2027 example.xlsx"), "PK changed");
    assert.throws(() => loadInstance(root), /inventory changed/);
    const manifest = JSON.parse(
      readFileSync(join(root, "instance.json"), "utf8"),
    );
    manifest.configFile = "../outside.json";
    writeFileSync(join(root, "instance.json"), JSON.stringify(manifest));
    assert.throws(() => loadInstance(root), /Invalid instance file path/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("mocked bootstrap regenerates imports without copying credentials and targets the existing project", () => {
  const { root, target } = fixture(),
    app = mkdtempSync(join(tmpdir(), "dayoff-app-")),
    commands: Command[] = [];
  try {
    writeFileSync(join(root, ".clasprc.json"), "credential-must-not-be-copied");
    prepareInstance(loadInstance(root), app, (command) =>
      commands.push(command),
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(app, ".clasp.json"), "utf8")),
      { scriptId: target.scriptId, rootDir: "build" },
    );
    assert.equal(existsSync(join(app, ".clasprc.json")), false);
    assert.match(
      readFileSync(join(app, ".env"), "utf8"),
      /DAYOFF_HISTORY=local\/attendance-history.json/,
    );
    assert.deepEqual(
      commands.slice(0, 2).map((c) => [c.command, c.args]),
      [
        ["npm", ["ci"]],
        ["uv", ["sync", "--locked"]],
      ],
    );
    assert.ok(commands[2].args.includes("--fy"));
    assert.ok(commands[3].args.includes("--source-directory"));
    assert.ok(
      commands[3].args.includes("--hr-system-name=HR accounting system"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(app, { recursive: true, force: true });
  }
});
test("deployment dry run performs no commands or writes; mocked deployment binds explicit private inputs", () => {
  const { root, target } = fixture(),
    app = mkdtempSync(join(tmpdir(), "dayoff-app-")),
    commands: Command[] = [];
  try {
    runInstance("deploy", root, true, (command) => commands.push(command), app);
    assert.equal(commands.length, 0);
    assert.equal(existsSync(join(app, ".env")), false);
    runInstance(
      "deploy",
      root,
      false,
      (command) => commands.push(command),
      app,
    );
    const deployment = commands.at(-1)!;
    assert.equal(deployment.command, "./scripts/update.sh");
    assert.equal(deployment.env?.DAYOFF_DEPLOYMENT_ID, target.deploymentId);
    assert.equal(deployment.env?.DAYOFF_CONFIG, join(root, "config.json"));
    assert.equal(
      deployment.env?.DAYOFF_HISTORY,
      join(app, "local/attendance-history.json"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(app, { recursive: true, force: true });
  }
});
