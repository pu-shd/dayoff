import { build } from "esbuild";
import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const env = existsSync(".env") ? await readFile(".env", "utf8") : "";
const vars = {};
for (const line of env.split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line);
  if (m) vars[m[1]] = m[2].trim();
}
const path = process.env.DAYOFF_CONFIG || vars.DAYOFF_CONFIG;
const config = JSON.parse(
  await readFile(path || "config/example.json", "utf8"),
);
const seedPath = process.env.DAYOFF_IMPORT || vars.DAYOFF_IMPORT;
const seed =
  seedPath && existsSync(seedPath)
    ? JSON.parse(await readFile(seedPath, "utf8"))
    : { records: [] };
if (seedPath && !existsSync(seedPath))
  throw Error(
    "Configured import file does not exist. Import a workbook or remove DAYOFF_IMPORT.",
  );
if (seed.fiscalYear && seed.fiscalYear !== config.fiscalYear)
  throw Error("Import and configuration fiscal years differ.");
if (
  seed.records?.length &&
  (seed.fiscalYearStart ?? "07-01") !== (config.fiscalYearStart ?? "07-01")
)
  throw Error("Workbook import and configuration fiscal-year starts differ.");
const domain = await build({
  entryPoints: ["src/domain.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const { validateConfig } = await import(
  "data:text/javascript;base64," +
    Buffer.from(domain.outputFiles[0].text).toString("base64")
);
validateConfig({ ...config, policy: { ...config.policy, ...seed.policy } });
const historyPath = process.env.DAYOFF_HISTORY || vars.DAYOFF_HISTORY;
const history = historyPath
  ? JSON.parse(await readFile(historyPath, "utf8"))
  : { schemaVersion: 1, anchorFiscalYear: config.fiscalYear, years: [] };
const historyModule = await build({
  entryPoints: ["src/history.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const { validateHistory } = await import(
  "data:text/javascript;base64," +
    Buffer.from(historyModule.outputFiles[0].text).toString("base64")
);
validateHistory(history);
await mkdir("build", { recursive: true });
await build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  format: "iife",
  globalName: "Dayoff",
  target: "es2020",
  outfile: "build/Code.js",
  define: {
    DAYOFF_CONFIG: JSON.stringify(config),
    DAYOFF_SEED: JSON.stringify(seed),
    DAYOFF_HISTORY: JSON.stringify(history),
  },
});
const handlers = [
  "doGet",
  "getDashboard",
  "initialize",
  "importHistory",
  "getHistoryYear",
  "preview",
  "createRequest",
  "cancelRequest",
  "confirmCalm",
  "retryRequest",
  "resolveEmail",
  "installReminders",
  "saveReminders",
  "sendReminderNow",
  "stopReminders",
  "testMail",
  "sendCalmReminders",
  "exportReport",
  "health",
];
await writeFile(
  "build/Entry.js",
  handlers
    .map(
      (name) =>
        "function " +
        name +
        "() { return Dayoff.handlers." +
        name +
        ".apply(null, arguments); }",
    )
    .join("\n") + "\n",
);
await copyFile("src/Index.html", "build/Index.html");
await writeFile(
  "build/appsscript.json",
  JSON.stringify(
    {
      timeZone: config.timeZone,
      runtimeVersion: "V8",
      dependencies: {
        enabledAdvancedServices: [
          { userSymbol: "Calendar", serviceId: "calendar", version: "v3" },
        ],
      },
      oauthScopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/script.send_mail",
        "https://www.googleapis.com/auth/script.scriptapp",
        "https://www.googleapis.com/auth/userinfo.email",
      ],
      webapp: { access: "MYSELF", executeAs: "USER_DEPLOYING" },
      exceptionLogging: "NONE",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Built Apps Script bundle (" +
    (path ? "local configuration" : "example configuration") +
    ", delivery " +
    config.delivery +
    ").",
);
if (!path)
  console.log("Example build only. Set DAYOFF_CONFIG before deployment.");
// Prevent accidental deployment of an example or missing private configuration.
await writeFile(
  "build/.build-info.json",
  JSON.stringify({
    configured: !!path,
    configPath: path ? resolve(path) : null,
    delivery: config.delivery,
  }) + "\n",
);
