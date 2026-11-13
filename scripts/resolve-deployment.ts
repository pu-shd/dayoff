import { readFile, writeFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { OAuth2Client, type Credentials } from "google-auth-library";
import { webAppUrl } from "../src/deployment.js";
async function main() {
  let path = process.env.clasp_config_auth || join(homedir(), ".clasprc.json");
  if ((await stat(path)).isDirectory()) path = join(path, ".clasprc.json");
  const saved = JSON.parse(await readFile(path, "utf8")) as {
    tokens?: Record<
      string,
      Credentials & { client_id?: string; client_secret?: string }
    >;
  };
  const token = saved.tokens?.default;
  if (!token?.client_id || !token.client_secret)
    throw Error("Missing default clasp credentials.");
  const auth = new OAuth2Client({
    clientId: token.client_id,
    clientSecret: token.client_secret,
  });
  auth.setCredentials(token);
  const project = JSON.parse(await readFile(".clasp.json", "utf8")) as {
    scriptId: string;
  };
  const deployment = JSON.parse(
    await readFile("local/deployment.json", "utf8"),
  ) as { deploymentId: string; webAppUrl?: string };
  const result = await auth.request({
    url:
      "https://script.googleapis.com/v1/projects/" +
      encodeURIComponent(project.scriptId) +
      "/deployments/" +
      encodeURIComponent(deployment.deploymentId),
  });
  deployment.webAppUrl = webAppUrl(result.data);
  await writeFile(
    "local/deployment.json",
    JSON.stringify(deployment, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(deployment.webAppUrl);
}
main().catch(() => {
  console.error(
    "Could not verify the canonical owner-only deployment URL. Check clasp authorization and deployment metadata.",
  );
  process.exitCode = 1;
});
