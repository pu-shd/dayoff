import { invariant } from "./domain.js";
export function webAppUrl(data: unknown): string {
  invariant(data && typeof data === "object", "Invalid deployment metadata.");
  const points = (data as { entryPoints?: unknown }).entryPoints;
  invariant(Array.isArray(points), "No web app entry point in deployment.");
  const point = points.find(
    (p) => p && typeof p === "object" && p.entryPointType === "WEB_APP",
  );
  invariant(
    point?.webApp && typeof point.webApp.url === "string",
    "No web app URL in deployment.",
  );
  const config = point.webApp.entryPointConfig;
  invariant(
    config?.access === "MYSELF" && config?.executeAs === "USER_DEPLOYING",
    "Deployment must remain owner-only.",
  );
  const url = new URL(point.webApp.url);
  invariant(
    url.protocol === "https:" &&
      url.hostname === "script.google.com" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.search &&
      /^\/(?:a\/macros\/[^/]+\/s|macros\/s)\/[^/]+\/exec$/.test(url.pathname),
    "Invalid Google web app URL.",
  );
  return url.href;
}
