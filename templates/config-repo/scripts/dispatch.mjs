import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function git(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0)
    throw Error(
      "Application source checkout failed. Check network access and the pinned revision.",
    );
  return result.stdout.trim();
}
try {
  const [operation, ...options] = process.argv.slice(2),
    allowed = [
      "source",
      "test",
      "bootstrap",
      "build",
      "deploy",
      "update",
      "teardown",
      "inventory",
    ];
  if (
    !allowed.includes(operation) ||
    options.some(
      (x, i) =>
        x !== "--dry-run" &&
        x !== "--app-revision" &&
        options[i - 1] !== "--app-revision",
    )
  )
    throw Error("Use a documented instance operation and options.");
  const lockPath = join(root, "app.lock.json"),
    lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const pinIndex = options.indexOf("--app-revision"),
    next = pinIndex >= 0 ? options[pinIndex + 1] : undefined;
  if (
    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(
      lock.repository,
    ) ||
    !/^[a-f0-9]{40}$/.test(next ?? lock.revision)
  )
    throw Error("Invalid pinned application source.");
  if (pinIndex >= 0 && !next)
    throw Error("Supply a full application revision.");
  const dry = options.includes("--dry-run"),
    app = join(root, "local/app");
  if (dry) {
    console.log(
      "Dry run: would validate the instance, prepare its pinned public application, and " +
        operation +
        ". No files or deployments changed.",
    );
    process.exit(0);
  }
  if (next) {
    lock.revision = next;
    writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n", {
      mode: 0o600,
    });
  }
  mkdirSync(join(root, "local"), { recursive: true, mode: 0o700 });
  if (!existsSync(join(app, ".git"))) {
    mkdirSync(app, { recursive: true });
    git(["init"], app);
    git(["remote", "add", "origin", lock.repository], app);
  }
  if (git(["remote", "get-url", "origin"], app) !== lock.repository)
    throw Error(
      "The application checkout has another origin. Preserve it and use a clean checkout.",
    );
  if (git(["status", "--porcelain", "--untracked-files=no"], app))
    throw Error(
      "The application checkout contains source changes. Preserve them before updating.",
    );
  let current = "";
  try {
    current = git(["rev-parse", "HEAD"], app);
  } catch {
    /* A new checkout has no HEAD. */
  }
  if (current !== lock.revision) {
    git(["fetch", "--depth", "1", "origin", lock.revision], app);
    git(["checkout", "--detach", lock.revision], app);
  }
  console.log("PASS: pinned public application source prepared.");
  if (operation === "source" || operation === "test") process.exit(0);
  const result = spawnSync(
    process.execPath,
    [join(app, "scripts/instance.ts"), operation, "--instance", root],
    { cwd: root, stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Unable to prepare the private instance.",
  );
  process.exitCode = 1;
}
