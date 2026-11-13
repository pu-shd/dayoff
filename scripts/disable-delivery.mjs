import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
const vars = {};
if (existsSync(".env")) {
  for (const line of (await readFile(".env", "utf8")).split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m) vars[m[1]] = m[2].trim();
  }
}
const path = process.env.DAYOFF_CONFIG || vars.DAYOFF_CONFIG;
if (!path) throw Error("Set DAYOFF_CONFIG before teardown.");
const config = JSON.parse(await readFile(path, "utf8"));
config.delivery = "disabled";
await mkdir("local", { recursive: true });
await writeFile("local/teardown-config.json", JSON.stringify(config), {
  mode: 0o600,
});
console.log(
  "Prepared disabled-delivery configuration; original configuration retained.",
);
