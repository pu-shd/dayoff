import { rmSync } from "node:fs";
import { join } from "node:path";
if (!process.env.RUNNER_TEMP)
  throw Error("This command is for a GitHub Actions runner.");
for (const path of [
  "local",
  "build",
  ".env",
  ".clasp.json",
  join(process.env.RUNNER_TEMP, "dayoff-clasp.json"),
])
  rmSync(path, { recursive: true, force: true });
console.log("Removed ephemeral deployment material.");
