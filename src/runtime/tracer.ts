let tracerPath: string | undefined;

export function resolveTracerPath(): string {
  if (tracerPath === undefined) {
    tracerPath = require.resolve("dd-trace", { paths: ["/var/task/node_modules", ...module.paths] });
  }
  return tracerPath;
}
