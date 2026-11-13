import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const required = [
  "DAYOFF_CONFIG_JSON",
  "CLASP_AUTH_JSON",
  "CLASP_PROJECT_JSON",
  "DAYOFF_DEPLOYMENT_ID",
];
for (const name of required)
  if (!process.env[name])
    throw Error("Missing GitHub environment secret: " + name);
if (!process.env.RUNNER_TEMP)
  throw Error("This command is for a GitHub Actions runner.");
mkdirSync("local", { recursive: true, mode: 0o700 });
const write = (name, data) =>
  writeFileSync(name, JSON.stringify(data), { mode: 0o600 });
write("local/config.json", JSON.parse(process.env.DAYOFF_CONFIG_JSON));
write(
  "local/legacy.json",
  process.env.DAYOFF_SEED_JSON
    ? JSON.parse(process.env.DAYOFF_SEED_JSON)
    : { records: [] },
);
write(".clasp.json", JSON.parse(process.env.CLASP_PROJECT_JSON));
write(
  join(process.env.RUNNER_TEMP, "dayoff-clasp.json"),
  JSON.parse(process.env.CLASP_AUTH_JSON),
);
writeFileSync(
  ".env",
  "DAYOFF_CONFIG=local/config.json\nDAYOFF_IMPORT=local/legacy.json\n",
  { mode: 0o600 },
);
console.log(
  "Restored ephemeral private configuration; no data or credentials are printed.",
);
