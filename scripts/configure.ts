import { readFile, writeFile, mkdir, rename, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
async function main() {
  const args = process.argv.slice(2);
  let calendar: string | undefined,
    path: string | undefined,
    dry = false;
  const recipients: string[] = [];
  let fiscalStart: string | undefined;
  if (args.includes("--help")) {
    console.log(
      "Usage: node scripts/configure.ts [--calendar-id ID] [--management-email ADDRESS ...] [--fiscal-year-start MM-DD] [--config PATH] [--dry-run]",
    );
    return;
  }
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--dry-run") {
      dry = true;
      continue;
    }
    if (
      flag !== "--calendar-id" &&
      flag !== "--management-email" &&
      flag !== "--fiscal-year-start" &&
      flag !== "--config"
    )
      throw Error("Unknown configuration option.");
    const value = args[++i];
    if (!value || value.startsWith("--"))
      throw Error("Configuration option requires a value.");
    if (flag === "--calendar-id") {
      if (calendar) throw Error("Supply one calendar ID.");
      calendar = value;
    } else if (flag === "--fiscal-year-start") {
      if (fiscalStart) throw Error("Supply one fiscal-year start.");
      fiscalStart = value;
    } else if (flag === "--management-email") {
      recipients.push(value);
    } else {
      if (path) throw Error("Supply one configuration path.");
      path = value;
    }
  }
  if (
    calendar !== undefined &&
    !/^[A-Za-z0-9_.+%=-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(calendar)
  )
    throw Error("Supply a valid Calendar ID, not a calendar URL.");
  if (
    fiscalStart &&
    (!/^\d{2}-\d{2}$/.test(fiscalStart) ||
      Number.isNaN(Date.parse("2001-" + fiscalStart)) ||
      new Date("2001-" + fiscalStart).toISOString().slice(5, 10) !==
        fiscalStart)
  )
    throw Error("Supply a valid annual fiscal-year start in MM-DD format.");
  if (!calendar && !recipients.length && !fiscalStart)
    throw Error(
      "Supply --calendar-id, --management-email, or --fiscal-year-start.",
    );
  if (
    recipients.some(
      (email) => !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email),
    )
  )
    throw Error("Supply a valid management email address.");
  if (
    new Set(recipients.map((email) => email.toLowerCase())).size !==
    recipients.length
  )
    throw Error("Supply each management email address once.");
  const vars: Record<string, string> = {};
  if (existsSync(".env"))
    for (const line of (await readFile(".env", "utf8")).split(/\r?\n/)) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line);
      if (m) vars[m[1]] = m[2].trim();
    }
  const target = resolve(
    path ||
      process.env.DAYOFF_CONFIG ||
      vars.DAYOFF_CONFIG ||
      "local/config.json",
  );
  const source = existsSync(target)
    ? target
    : fileURLToPath(new URL("../config/example.json", import.meta.url));
  const data: unknown = JSON.parse(await readFile(source, "utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw Error("Configuration must be a JSON object.");
  const updated = {
    ...data,
    ...(fiscalStart ? { fiscalYearStart: fiscalStart } : {}),
    ...(calendar ? { calendarId: calendar } : {}),
    ...(recipients.length ? { managementEmails: recipients } : {}),
  };
  if (dry) {
    console.log(
      "Dry run: would update private connection settings; no files changed.",
    );
    return;
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = target + ".next";
  await writeFile(temporary, JSON.stringify(updated, null, 2) + "\n", {
    mode: 0o600,
  });
  await chmod(temporary, 0o600);
  await rename(temporary, target);
  console.log(
    "Private connection settings configured. Other settings and delivery mode retained.",
  );
}
main().catch((e) => {
  console.error(
    e instanceof Error && /^(Supply|Unknown|Configuration)/.test(e.message)
      ? e.message
      : "Unable to update private configuration. Check the file path and permissions.",
  );
  process.exitCode = 1;
});
