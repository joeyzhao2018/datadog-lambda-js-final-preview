import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

let tracerPath: string | undefined;

export function resolveTracerPath(): string {
  if (tracerPath === undefined) {
    // Bundlers replace require.resolve and may omit module.paths from their module objects.
    // Anchor Node's resolver to the deployed shim or bundle, preserving function-local precedence.
    const nodeRequire = createRequire(typeof __filename === "string" ? __filename : resolve("package.json"));
    tracerPath = existsSync("/var/task/node_modules/dd-trace")
      ? nodeRequire.resolve("dd-trace", { paths: ["/var/task/node_modules"] })
      : nodeRequire.resolve("dd-trace");
  }
  return tracerPath;
}
