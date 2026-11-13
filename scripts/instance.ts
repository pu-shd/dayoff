import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  realpathSync,
  lstatSync,
  copyFileSync,
  cpSync,
  chmodSync,
} from "node:fs";
import { resolve, dirname, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { validateConfig, hrSystemName, type Config } from "../src/domain.ts";
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
interface Definition {
  version: 1;
  configFile: string;
  sourceDirectory: string;
  inventoryFile: string;
  targetFile: string;
  anchorFiscalYear: number;
}
interface Source {
  fiscalYear: number;
  name: string;
  sha256: string;
}
interface Target {
  scriptId: string;
  deploymentId: string;
  webAppUrl: string;
}
interface Lock {
  repository: string;
  revision: string;
}
export interface Instance {
  root: string;
  definition: Definition;
  config: Config;
  sources: Source[];
  target: Target;
  lock: Lock;
  configPath: string;
  sourceDirectory: string;
}
export interface Command {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}
export type Runner = (command: Command) => void;
function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
function json<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
function write(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}
function privatePath(root: string, value: string) {
  assert(
    typeof value === "string" &&
      value.length > 0 &&
      !/[\r\n]/.test(value) &&
      !isAbsolute(value),
    "Invalid instance file path.",
  );
  const path = resolve(root, value),
    part = relative(root, path);
  assert(
    part !== "" && !part.startsWith("..") && !isAbsolute(part),
    "Invalid instance file path.",
  );
  if (existsSync(path)) {
    const actual = relative(realpathSync(root), realpathSync(path));
    assert(
      !actual.startsWith("..") && !isAbsolute(actual),
      "Invalid instance symlink.",
    );
  }
  return path;
}
function inventory(folder: string): Source[] {
  const years = new Set<number>();
  const sources = readdirSync(folder)
    .filter((name) => /\.xlsx$/i.test(name) && !name.startsWith("~$"))
    .map((name) => {
      const m = /^fy(\d{4})\b/i.exec(name);
      assert(m, "Invalid workbook filename; expected FY followed by a year.");
      const fiscalYear = Number(m[1]);
      assert(
        fiscalYear >= 2000 && fiscalYear <= 2200 && !years.has(fiscalYear),
        "Invalid or duplicate workbook fiscal year.",
      );
      years.add(fiscalYear);
      const path = join(folder, name);
      assert(
        lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(),
        "Invalid workbook source file.",
      );
      const bytes = readFileSync(path);
      assert(
        bytes.subarray(0, 2).toString() === "PK",
        "Invalid XLSX source file.",
      );
      return {
        fiscalYear,
        name,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    });
  assert(sources.length > 0, "No source workbooks found.");
  return sources.sort((a, b) => b.fiscalYear - a.fiscalYear);
}
export function loadInstance(rootPath: string, verify = true): Instance {
  const root = resolve(rootPath);
  assert(!/[\r\n]/.test(root), "Invalid instance directory.");
  const definition = json<Definition>(join(root, "instance.json"));
  assert(definition.version === 1, "Unsupported instance manifest version.");
  const configPath = privatePath(root, definition.configFile),
    sourceDirectory = privatePath(root, definition.sourceDirectory);
  const config = validateConfig(json<Config>(configPath)),
    target = json<Target>(privatePath(root, definition.targetFile)),
    lock = json<Lock>(join(root, "app.lock.json"));
  assert(
    /^[A-Za-z0-9_-]{20,200}$/.test(target.scriptId) &&
      /^[A-Za-z0-9_-]{20,200}$/.test(target.deploymentId),
    "Invalid Apps Script target identifiers.",
  );
  assert(
    typeof target.webAppUrl === "string" &&
      /^https:\/\/script\.google\.com\/(?:a\/macros\/[^/]+\/s|macros\/s)\/[A-Za-z0-9_-]+\/exec$/.test(
        target.webAppUrl,
      ),
    "Invalid canonical web app URL.",
  );
  assert(
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(
      lock.repository,
    ) && /^[a-f0-9]{40}$/.test(lock.revision),
    "Invalid pinned application source.",
  );
  const sources = inventory(sourceDirectory);
  assert(
    sources.some((s) => s.fiscalYear === config.fiscalYear),
    "No workbook matches the configured current fiscal year.",
  );
  assert(
    definition.anchorFiscalYear === sources[0].fiscalYear,
    "Invalid history anchor; use the latest source year.",
  );
  const inventoryPath = privatePath(root, definition.inventoryFile);
  if (verify)
    assert(
      JSON.stringify(json<Source[]>(inventoryPath)) === JSON.stringify(sources),
      "Source inventory changed. Review the workbooks and refresh the private inventory.",
    );
  return {
    root,
    definition,
    config,
    sources,
    target,
    lock,
    configPath,
    sourceDirectory,
  };
}
const run: Runner = (task) => {
  const result = spawnSync(task.command, task.args, {
    cwd: task.cwd,
    env: { ...process.env, ...task.env },
    stdio: "inherit",
  });
  assert(
    !result.error && result.status === 0,
    "Instance operation failed; review the named step above.",
  );
};
export function prepareInstance(
  instance: Instance,
  applicationRoot: string,
  runner: Runner = run,
) {
  const root = resolve(applicationRoot);
  mkdirSync(join(root, "local"), { recursive: true, mode: 0o700 });
  const clasp = join(root, ".clasp.json");
  if (existsSync(clasp))
    assert(
      json<{ scriptId: string }>(clasp).scriptId === instance.target.scriptId,
      "The application checkout targets a different Apps Script project. Use a clean checkout.",
    );
  write(clasp, { scriptId: instance.target.scriptId, rootDir: "build" });
  write(join(root, "local/deployment.json"), { ...instance.target });
  writeFileSync(
    join(root, ".env"),
    "DAYOFF_CONFIG=" +
      instance.configPath +
      "\nDAYOFF_IMPORT=local/legacy.json\nDAYOFF_HISTORY=local/attendance-history.json\n",
    { mode: 0o600 },
  );
  chmodSync(join(root, ".env"), 0o600);
  for (const [command, args] of [
    ["npm", ["ci"]],
    ["uv", ["sync", "--locked"]],
  ] as const)
    runner({ command, args: [...args], cwd: root });
  const source = instance.sources.find(
    (s) => s.fiscalYear === instance.config.fiscalYear,
  )!;
  runner({
    command: join(root, ".venv/bin/python"),
    args: [
      "scripts/import_workbook.py",
      join(instance.sourceDirectory, source.name),
      "--fy",
      String(instance.config.fiscalYear),
      "--output",
      "local/legacy.json",
      "--hr-system-name=" + hrSystemName(instance.config),
    ],
    cwd: root,
  });
  runner({
    command: join(root, ".venv/bin/python"),
    args: [
      "scripts/import_workbook.py",
      "--source-directory",
      instance.sourceDirectory,
      "--anchor-fy",
      String(instance.definition.anchorFiscalYear),
      "--output",
      "local/attendance-history.json",
      "--hr-system-name=" + hrSystemName(instance.config),
    ],
    cwd: root,
  });
}
export function runInstance(
  operation: string,
  root: string,
  dry: boolean,
  runner: Runner = run,
  applicationRoot = appRoot,
) {
  const instance = loadInstance(root, operation !== "inventory");
  assert(
    [
      "validate",
      "bootstrap",
      "build",
      "deploy",
      "update",
      "teardown",
      "inventory",
    ].includes(operation),
    "Invalid instance operation.",
  );
  if (operation === "validate") {
    console.log(
      "PASS: instance settings, pinned application and target identifiers validated.",
    );
    console.log(
      "PASS: source inventory verified (" +
        instance.sources.length +
        " workbooks).",
    );
    return;
  }
  if (dry) {
    console.log(
      "Dry run: would " +
        operation +
        " the private instance using its pinned application and existing target. No files or deployments changed.",
    );
    return;
  }
  if (operation === "inventory") {
    write(
      privatePath(instance.root, instance.definition.inventoryFile),
      instance.sources,
    );
    console.log("PASS: private source inventory refreshed.");
    return;
  }
  prepareInstance(instance, applicationRoot, runner);
  if (operation === "bootstrap") {
    console.log(
      "PASS: private configuration bound and workbook imports regenerated.",
    );
    return;
  }
  if (operation === "build") {
    runner({
      command: "npm",
      args: ["run", "build"],
      cwd: applicationRoot,
      env: {
        DAYOFF_CONFIG: instance.configPath,
        DAYOFF_IMPORT: join(applicationRoot, "local/legacy.json"),
        DAYOFF_HISTORY: join(applicationRoot, "local/attendance-history.json"),
      },
    });
    return;
  }
  let revision = "";
  try {
    revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: instance.root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    /* An uncommitted local instance has no revision yet. */
  }
  const env: NodeJS.ProcessEnv = {
    DAYOFF_CONFIG: instance.configPath,
    DAYOFF_IMPORT: join(applicationRoot, "local/legacy.json"),
    DAYOFF_HISTORY: join(applicationRoot, "local/attendance-history.json"),
    DAYOFF_DEPLOYMENT_ID: instance.target.deploymentId,
    ...(revision ? { DAYOFF_CONFIG_REVISION: revision } : {}),
  };
  runner({
    command:
      operation === "teardown"
        ? "./scripts/teardown.sh"
        : "./scripts/update.sh",
    args: operation === "teardown" ? [instance.target.deploymentId] : [],
    cwd: applicationRoot,
    env,
  });
  console.log("PASS: instance " + operation + " completed.");
}
export function initializeInstance(
  rootPath: string,
  sourcePath: string,
  dry: boolean,
  applicationRoot = appRoot,
) {
  const root = resolve(rootPath),
    sourceDirectory = resolve(sourcePath);
  assert(
    !existsSync(root) || readdirSync(root).length === 0,
    "The new private instance directory must be empty.",
  );
  const envPath = join(applicationRoot, ".env"),
    vars = Object.fromEntries(
      readFileSync(envPath, "utf8")
        .split(/\r?\n/)
        .map((line) => /^([A-Z_]+)=(.*)$/.exec(line))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => [m[1], m[2].trim()]),
    );
  assert(
    vars.DAYOFF_CONFIG,
    "Configure the current application before separating its instance.",
  );
  const config = validateConfig(
      json<Config>(resolve(applicationRoot, vars.DAYOFF_CONFIG)),
    ),
    project = json<{ scriptId: string }>(join(applicationRoot, ".clasp.json")),
    deployment = json<Target>(join(applicationRoot, "local/deployment.json"));
  const sources = inventory(sourceDirectory);
  assert(
    sources.some((s) => s.fiscalYear === config.fiscalYear),
    "No source workbook matches the current fiscal year.",
  );
  if (dry) {
    console.log(
      "Dry run: would copy private settings, target identifiers and " +
        sources.length +
        " original workbooks. Credentials and generated imports are excluded.",
    );
    return;
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  cpSync(join(applicationRoot, "templates/config-repo"), root, {
    recursive: true,
  });
  const configKeys: (keyof Config)[] = [
    "hrSystemName",
    "fiscalYear",
    "fiscalYearStart",
    "timeZone",
    "displayName",
    "ownerEmail",
    "managementEmails",
    "calendarId",
    "delivery",
    "reminderHour",
    "policy",
    "schedules",
    "holidays",
  ];
  write(
    join(root, "config.json"),
    Object.fromEntries(
      configKeys
        .filter((key) => config[key] !== undefined)
        .map((key) => [key, config[key]]),
    ),
  );
  write(join(root, "target.json"), {
    scriptId: project.scriptId,
    deploymentId: deployment.deploymentId,
    webAppUrl: deployment.webAppUrl,
  });
  const definition: Definition = {
    version: 1,
    configFile: "config.json",
    sourceDirectory: "sources/workbooks",
    inventoryFile: "sources/inventory.json",
    targetFile: "target.json",
    anchorFiscalYear: sources[0].fiscalYear,
  };
  write(join(root, "instance.json"), definition);
  write(join(root, "app.lock.json"), {
    repository: "https://github.com/pu-shd/dayoff.git",
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: applicationRoot,
      encoding: "utf8",
    }).trim(),
  });
  mkdirSync(join(root, definition.sourceDirectory), {
    recursive: true,
    mode: 0o700,
  });
  for (const source of sources)
    copyFileSync(
      join(sourceDirectory, source.name),
      join(root, definition.sourceDirectory, source.name),
    );
  write(join(root, definition.inventoryFile), sources);
  for (const name of readdirSync(join(root, "scripts")).filter((n) =>
    n.endsWith(".sh"),
  ))
    chmodSync(join(root, "scripts", name), 0o755);
  loadInstance(root);
  console.log(
    "PASS: private instance initialized with " +
      sources.length +
      " verified workbooks; original sources retained.",
  );
}
function main() {
  const args = process.argv.slice(2),
    operation = args.shift();
  let root = "",
    source = "",
    dry = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") {
      dry = true;
      continue;
    }
    assert(
      ["--instance", "--workbooks"].includes(args[i]),
      "Invalid instance option.",
    );
    const value = args[++i];
    assert(value && !value.startsWith("--"), "Invalid instance option value.");
    if (args[i - 1] === "--instance") root = value;
    else source = value;
  }
  assert(
    operation && root,
    "Usage: node scripts/instance.ts OPERATION --instance DIR [--workbooks DIR] [--dry-run]",
  );
  if (operation === "init") {
    assert(source, "Supply --workbooks for initialization.");
    initializeInstance(root, source, dry);
  } else runInstance(operation, root, dry);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  try {
    main();
  } catch (error) {
    console.error(
      error instanceof Error &&
        /^(Invalid|Unsupported|No |Source|The |Configure|Supply|Usage|Instance)/.test(
          error.message,
        )
        ? error.message
        : "Unable to process the private instance. Check its files and permissions.",
    );
    process.exitCode = 1;
  }
