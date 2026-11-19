const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { spawnSync } = require("node:child_process");
const { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { basename, dirname, join, resolve } = require("node:path");

const esbuild = require("esbuild");
const webpack = require("webpack");

const root = resolve(__dirname, "..");
let temporary;
let packed;

function write(file, body) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
}

function command(file, args, options) {
  const result = spawnSync(file, args, { encoding: "utf8", timeout: 30000, ...options });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

before(() => {
  temporary = realpathSync(mkdtempSync(join(tmpdir(), "lambda-shim-bundling-")));
  const metadata = JSON.parse(
    command("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], {
      cwd: root,
      env: { ...process.env, NODE_OPTIONS: "" },
    }),
  )[0];
  command("tar", ["-xzf", join(temporary, metadata.filename), "-C", temporary]);
  packed = join(temporary, "package");
});

after(() => {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
});

function tracer(directory, name) {
  write(join(directory, "package.json"), JSON.stringify({ name: "dd-trace", version: "6.12.0", main: "index.js" }));
  write(
    join(directory, "index.js"),
    `
    globalThis.events ||= [];
    exports.init = () => { globalThis.events.push('${name}:init'); return exports; };
    exports.use = () => { globalThis.events.push('${name}:http'); return exports; };
  `,
  );
  write(join(directory, "register.js"), `globalThis.events.push('${name}:register');`);
  write(
    join(directory, "packages/dd-trace/src/lambda/facade.js"),
    `
    globalThis.events ||= [];
    globalThis.events.push('${name}:facade');
    exports.wrap = (handler, config) => { globalThis.forwardedConfig = config; return handler; };
    exports.getTraceHeaders = () => ({ selected: '${name}' });
    exports.sendDistributionMetric = () => {};
    exports.sendDistributionMetricWithDate = () => {};
    exports.reportInitFailure = async () => {};
  `,
  );
}

async function bundle(tool, entry, output, format) {
  if (tool === "esbuild") {
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      platform: "node",
      target: "node18",
      format,
      outfile: output,
      external: ["dd-trace"],
      logLevel: "silent",
      ...(format === "esm"
        ? {
            banner: {
              js: `import { createRequire as nativeRequire } from 'node:module';
          globalThis.require = nativeRequire(import.meta.url);`,
            },
          }
        : {}),
    });
    return;
  }
  await new Promise((resolveBuild, reject) => {
    const compiler = webpack({
      mode: "development",
      entry,
      target: "node18",
      devtool: false,
      externalsType: "node-commonjs",
      externals: ["dd-trace"],
      optimization: { minimize: false },
      output: {
        path: dirname(output),
        filename: basename(output),
        library: { type: format === "esm" ? "module" : "commonjs2" },
        ...(format === "esm" ? { module: true } : {}),
      },
      ...(format === "esm" ? { experiments: { outputModule: true } } : {}),
    });
    compiler.run((error, stats) =>
      compiler.close((closeError) => {
        if (error || closeError) return reject(error || closeError);
        if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })));
        resolveBuild();
      }),
    );
  });
}

for (const tool of ["esbuild", "webpack"]) {
  for (const format of ["cjs", "esm"]) {
    for (const local of [true, false]) {
      for (const bootstrap of [false, true]) {
        test(`${tool} ${format} bundled ${bootstrap ? "startup" : "wrapper"} selects ${
          local ? "local" : "layer"
        } tracer after relocation`, async () => {
          const directory = mkdtempSync(join(temporary, "installation-"));
          const build = join(directory, "build");
          const deploy = join(directory, "task");
          const layer = join(directory, "layer/nodejs/node_modules");
          const shim = join(build, "node_modules/datadog-lambda-js");
          cpSync(packed, shim, { recursive: true });
          symlinkSync(
            dirname(require.resolve("serialize-error/package.json")),
            join(build, "node_modules/serialize-error"),
          );
          mkdirSync(deploy, { recursive: true });
          if (local) tracer(join(deploy, "node_modules/dd-trace"), "local");
          tracer(join(layer, "dd-trace"), "layer");
          const entry = join(build, "entry.cjs");
          write(
            entry,
            bootstrap
              ? `exports.start = require('datadog-lambda-js/dist/runtime/module_importer').initTracer;`
              : `module.exports = require('datadog-lambda-js');`,
          );
          const name = format === "esm" ? "handler.mjs" : "handler.cjs";
          await bundle(tool, entry, join(build, name), format);
          // Deploy only the bundle. The build tree and shim package are unavailable at runtime.
          cpSync(join(build, name), join(deploy, name));
          rmSync(build, { recursive: true, force: true });
          const selected = local ? "local" : "layer";
          write(
            join(deploy, "run.cjs"),
            `
            const assert = require('node:assert/strict');
            (async () => {
              const imported = ${format === "esm" ? "await import('./handler.mjs')" : "require('./handler.cjs')"};
              const shim = imported.default || imported;
              ${
                bootstrap
                  ? `
                await shim.start();
                await shim.start();
                assert.equal(globalThis.events.filter(event => event === '${selected}:init').length, 2);
                assert.equal(globalThis.events.filter(event => event === '${selected}:register').length, 1);
                assert.ok(globalThis.events.every(event => event.startsWith('${selected}:')));
              `
                  : `
                const handler = (event, context, callback) => callback(null, event);
                const config = { enhancedMetrics: false };
                const wrapped = shim.datadog(handler, config);
                const event = {};
                const context = {};
                wrapped(event, context, (error, result) => { assert.equal(error, null); assert.equal(result, event); });
                assert.deepEqual(shim.getTraceHeaders(), { selected: '${selected}' });
                assert.deepEqual(globalThis.events, ['${selected}:facade']);
                assert.equal(globalThis.forwardedConfig.enhancedMetrics, false);
              `
              }
            })().catch(error => { console.error(error); process.exitCode = 1; });
          `,
          );
          const cleanEnv = Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !/^(DD_|AWS_|LAMBDA_|NODE_OPTIONS$|NODE_PATH$)/.test(key)),
          );
          command(process.execPath, [join(deploy, "run.cjs")], { cwd: deploy, env: { ...cleanEnv, NODE_PATH: layer } });
        });
      }
    }
  }
}
