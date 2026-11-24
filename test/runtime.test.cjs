const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { spawnSync } = require("node:child_process");
const {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const root = resolve(__dirname, "..");
let temporary;
let packed;
let files;

function command(executable, args, options) {
  const result = spawnSync(executable, args, { encoding: "utf8", timeout: 30000, ...options });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

before(() => {
  temporary = realpathSync(mkdtempSync(join(tmpdir(), "lambda-preview-review-")));
  const result = JSON.parse(
    command("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], {
      cwd: root,
      env: { ...process.env, NODE_OPTIONS: "" },
    }),
  )[0];
  files = result.files.map((file) => file.path);
  command("tar", ["-xzf", join(temporary, result.filename), "-C", temporary]);
  packed = join(temporary, "package");
});

after(() => {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
});

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

const loader = `
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.endsWith('/customer.mjs')) {
    return { ...result, source: result.source + '\\nglobalThis.loaderTouches = (globalThis.loaderTouches || 0) + 1;' };
  }
  return result;
}
`;

function tracer(directory, name, { facade = true, register = true } = {}) {
  write(join(directory, "package.json"), JSON.stringify({ name: "dd-trace", version: "6.12.0", main: "index.js" }));
  write(
    join(directory, "index.js"),
    `globalThis.events ||= [];
     globalThis.events.push('${name}:require');
     exports.init = () => { globalThis.events.push('${name}:init'); return exports; };`,
  );
  if (facade) {
    write(
      join(directory, "packages/dd-trace/src/lambda/facade.js"),
      `globalThis.events ||= [];
       globalThis.events.push('${name}:facade');
       exports.wrap = (handler, config) => { globalThis.forwardedConfig = config; return handler; };
       exports.sendDistributionMetric = () => {};
       exports.sendDistributionMetricWithDate = () => {};
       exports.getTraceHeaders = () => ({});
       exports.reportInitFailure = async failure => {
         globalThis.initFailure = failure;
         if (process.env.FAIL_TELEMETRY) throw new Error('telemetry failed');
       };`,
    );
  }
  write(join(directory, "loader-hook.mjs"), loader);
  if (register) {
    write(
      join(directory, "register.js"),
      `if (require('node:worker_threads').isMainThread) {
         globalThis.events ||= [];
         globalThis.events.push('${name}:register');
         require('node:module').register(require('node:url').pathToFileURL(__dirname + '/loader-hook.mjs'));
       }`,
    );
  }
  write(
    join(directory, "initialize.mjs"),
    `import { isMainThread } from 'node:worker_threads';
     import { register } from 'node:module';
     export { load } from './loader-hook.mjs';
     if (isMainThread) {
       globalThis.events ||= [];
       globalThis.events.push('${name}:initialize');
       register('./loader-hook.mjs', import.meta.url);
     }`,
  );
}

function fixture({ local = true, facade = true, register = true } = {}) {
  const installation = mkdtempSync(join(temporary, "installation-"));
  const directory = join(installation, "task");
  const shim = join(directory, "node_modules/datadog-lambda-js");
  const localTracer = join(directory, "node_modules/dd-trace");
  const layer = join(installation, "node_modules");
  cpSync(packed, shim, { recursive: true });
  symlinkSync(
    dirname(require.resolve("serialize-error/package.json")),
    join(directory, "node_modules/serialize-error"),
  );
  if (local) tracer(localTracer, "local", { facade, register });
  tracer(join(layer, "dd-trace"), "layer");
  write(join(directory, "customer.mjs"), "export const handler = async () => globalThis.loaderTouches;");
  write(join(directory, "commonjs.cjs"), "exports.handler = async () => 'cjs result';");
  return {
    directory,
    shim,
    localTracer,
    layer,
    run(body, { flags = [], env = {} } = {}) {
      const cleanEnv = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !/^(DD_|AWS_|LAMBDA_|NODE_OPTIONS$|NODE_PATH$)/.test(key)),
      );
      write(
        join(directory, "run.cjs"),
        `const assert = require('node:assert/strict');
         const { pathToFileURL } = require('node:url');
         const importer = require('datadog-lambda-js/dist/runtime/module_importer');
         const handlerUrl = pathToFileURL(require.resolve('datadog-lambda-js/dist/handler.mjs')).href;
         (async () => { ${body} })().catch(error => { console.error(error); process.exitCode = 1; });`,
      );
      return command(process.execPath, [...flags, join(directory, "run.cjs")], {
        cwd: directory,
        env: {
          ...cleanEnv,
          LAMBDA_TASK_ROOT: directory,
          DD_LAMBDA_HANDLER: "customer.handler",
          ...env,
        },
      });
    },
  };
}

test("the npm artifact contains unchanged runtime files and no runtime test fixtures", () => {
  for (const file of ["handler.mjs", "runtime/module_importer.js"]) {
    assert.ok(files.includes(`dist/${file}`));
    assert.equal(readFileSync(join(packed, "dist", file), "utf8"), readFileSync(join(root, "src", file), "utf8"));
  }
  assert.ok(files.includes("dist/runtime/tracer.js"));
  assert.ok(!files.some((file) => file.includes("/fixtures/")));
});

test("packed extractor declarations accept the current shim contract", () => {
  const ts = require("typescript");
  const program = ts.createProgram([join(__dirname, "types/custom-extractor.ts")], {
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ES2021,
    module: ts.ModuleKind.CommonJS,
    types: [],
    baseUrl: root,
    paths: {
      "datadog-lambda-js": [join(packed, "dist/index.d.ts")],
      "datadog-lambda-js/dist/facade": [join(packed, "dist/facade.d.ts")],
      "aws-lambda": [require.resolve("@types/aws-lambda/index.d.ts")],
      node: [require.resolve("@types/node/index.d.ts")],
    },
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnostics(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (name) => name,
      getNewLine: () => "\n",
    }),
  );
});

test("manual wrapping forwards the current shim extractor contract unchanged", () => {
  fixture().run(`
    const { datadog } = require('datadog-lambda-js');
    for (const legacy of [false, true]) {
      for (const sampleMode of [-1, 0, 1, 2]) {
        for (const source of ['xray', 'event', 'ddtrace']) {
          const result = { sampleMode, source, ...(legacy
            ? { traceID: '1234', parentID: '5678' }
            : { traceId: '1234', parentId: '5678' }) };
          const event = {};
          const context = { awsRequestId: 'request-id' };
          const extractor = (receivedEvent, receivedContext) => {
            assert.equal(receivedEvent, event);
            assert.equal(receivedContext, context);
            return result;
          };
          for (const traceExtractor of [extractor, async (...args) => extractor(...args)]) {
            const config = { traceExtractor };
            datadog(() => {}, config);
            assert.notEqual(globalThis.forwardedConfig, config);
            const { datadogLambdaVersion, ...forwarded } = globalThis.forwardedConfig;
            assert.equal(datadogLambdaVersion, require('datadog-lambda-js/dist/constants').datadogLambdaVersion);
            assert.deepEqual(forwarded, config);
            assert.equal(globalThis.forwardedConfig.traceExtractor, traceExtractor);
            assert.equal(await globalThis.forwardedConfig.traceExtractor(event, context), result);
          }
        }
      }
    }
  `);
});

test("wrapping forwards the shim-owned published layer version without changing caller configuration", () => {
  fixture().run(`
    const { datadog } = require('datadog-lambda-js');
    const { datadogLambdaVersion } = require('datadog-lambda-js/dist/constants');
    const config = { datadogLambdaVersion: 'caller-value', captureLambdaPayload: true };
    datadog(() => {}, config);
    assert.equal(globalThis.forwardedConfig.datadogLambdaVersion, datadogLambdaVersion);
    assert.equal(globalThis.forwardedConfig.captureLambdaPayload, true);
    assert.deepEqual(config, { datadogLambdaVersion: 'caller-value', captureLambdaPayload: true });
  `);
});

for (const esm of [false, true]) {
  for (const asynchronous of [false, true]) {
    test(`DD_TRACE_EXTRACTOR forwards the loaded function (ESM: ${esm}, async: ${asynchronous})`, () => {
      const setup = fixture();
      const filename = esm ? "extractor.mjs" : "extractor.cjs";
      write(
        join(setup.directory, filename),
        `${esm ? "export const extract" : "exports.extract"} = ${asynchronous ? "async" : ""} (event, context) => {
          if (context.awsRequestId !== 'request-id') throw new Error('context was not forwarded');
          return event.traceContext;
        };`,
      );
      setup.run(
        `
        await import(handlerUrl);
        const loaded = await import(pathToFileURL(require('node:path').join(process.cwd(), '${filename}')).href);
        assert.equal(globalThis.forwardedConfig.traceExtractor, loaded.extract);
        for (const ids of [{ traceId: '1234', parentId: '5678' }, { traceID: '1234', parentID: '5678' }]) {
          const traceContext = { ...ids, sampleMode: 2, source: 'event' };
          assert.equal(await globalThis.forwardedConfig.traceExtractor(
            { traceContext }, { awsRequestId: 'request-id' }
          ), traceContext);
        }
      `,
        { env: { DD_TRACE_EXTRACTOR: "extractor.extract" } },
      );
    });
  }
}

test("the shim loads the internal bridge without a public Lambda entry point", () => {
  fixture().run(`
    assert.throws(() => require.resolve('dd-trace/lambda'), { code: 'MODULE_NOT_FOUND' });
    const { datadog } = require('datadog-lambda-js');
    const original = () => 'result';
    assert.equal(datadog(original), original);
    assert.deepEqual(globalThis.events, ['local:facade']);
  `);
});

test("the packed CJS handler initializes and wraps with the same function-local tracer", () => {
  const setup = fixture();
  setup.run(`
    process.env.DD_LAMBDA_HANDLER = 'commonjs.handler';
    const { handler } = await import(handlerUrl);
    assert.equal(await handler(), 'cjs result');
    assert.deepEqual(globalThis.events, ['local:require', 'local:init', 'local:register', 'local:facade']);
  `);
});

test("layer-only selection uses the same installation for hooks and facade", () => {
  fixture({ local: false }).run(`
    const { handler } = await import(handlerUrl);
    assert.equal(await handler(), 1);
    assert.deepEqual(globalThis.events, ['layer:require', 'layer:init', 'layer:register', 'layer:facade']);
  `);
});

for (const facadeFirst of [false, true]) {
  test(`an incompatible local tracer cannot fall through to the layer (facade first: ${facadeFirst})`, () => {
    fixture({ facade: false }).run(`
      const { datadog } = require('datadog-lambda-js');
      ${facadeFirst ? "" : "await importer.initTracer();"}
      assert.throws(() => datadog(() => {}), /could not load.*packages\\/dd-trace\\/src\\/lambda\\/facade/);
      ${facadeFirst ? "await importer.initTracer();" : ""}
      assert.ok(globalThis.events.includes('local:init'));
      assert.ok(globalThis.events.every(event => event.startsWith('local:')));
    `);
  });
}

test("constants-only imports stay lazy and the facade still checks all required methods", () => {
  const setup = fixture();
  write(join(setup.localTracer, "packages/dd-trace/src/lambda/facade.js"), "exports.wrap = handler => handler;");
  setup.run(`
    const shim = require('datadog-lambda-js');
    assert.equal(shim.datadogHandlerEnvVar, 'DD_LAMBDA_HANDLER');
    assert.equal(globalThis.events, undefined);
    assert.throws(() => shim.datadog(() => {}), /missing:.*reportInitFailure/);
    assert.equal(globalThis.events, undefined);
  `);
});

const loadOnce = `
  await importer.initTracer();
  await importer.initTracer();
  const { handler } = await import(handlerUrl);
  assert.equal(await handler(), 1);
  assert.ok(globalThis.events.every(event => event.startsWith('local:')));
`;

test("explicit registration happens before ESM customer evaluation and is idempotent", () => {
  fixture().run(loadOnce + "assert.equal(globalThis.events.filter(event => event === 'local:register').length, 1);");
});

for (const preload of ["register.js", "initialize.mjs"]) {
  for (const source of ["ignored environment", "environment", "command line"]) {
    test(`${preload}: ${source} registers exactly once`, () => {
      const setup = fixture();
      const flag = preload === "register.js" ? "--require" : "--import";
      const specifier =
        preload === "register.js" ? `dd-trace/${preload}` : pathToFileURL(join(setup.localTracer, preload)).href;
      const option = `${flag}=${specifier}`;
      setup.run(
        (source === "ignored environment" ? `process.env.NODE_OPTIONS = ${JSON.stringify(option)};` : "") + loadOnce,
        {
          flags: source === "command line" ? [option] : [],
          env: source === "environment" ? { NODE_OPTIONS: option } : {},
        },
      );
    });
  }
}

for (const source of ["environment", "command line"]) {
  for (const loaderName of ["loader-hook.mjs", "initialize.mjs"]) {
    test(`legacy ${loaderName} via ${source} is not registered twice`, () => {
      const setup = fixture();
      const option = `--loader=${pathToFileURL(join(setup.localTracer, loaderName)).href}`;
      setup.run(loadOnce, {
        flags: source === "command line" ? [option] : [],
        env: source === "environment" ? { NODE_OPTIONS: option } : {},
      });
    });
  }
}

test("a quoted --import path through a symlink reuses the initialized module", () => {
  const setup = fixture();
  const alias = join(setup.directory, "tracer alias");
  symlinkSync(setup.localTracer, alias);
  setup.run(loadOnce, { env: { NODE_OPTIONS: `--import="${join(alias, "initialize.mjs")}"` } });
});

test("a preload from a different installation does not suppress the selected tracer's hooks", () => {
  const setup = fixture();
  setup.run(`await importer.initTracer(); assert.ok(globalThis.events.includes('local:register'));`, {
    env: { NODE_OPTIONS: `--require=${join(setup.layer, "dd-trace/register.js")}` },
  });
});

test("older tracers without register.js use the loader fallback once", () => {
  fixture({ register: false }).run(loadOnce);
});

test("a broken register.js is logged, not mistaken for a missing entry point", () => {
  const setup = fixture();
  write(join(setup.localTracer, "register.js"), "require('./missing-internal-dependency');");
  const output = setup.run(
    `
    const { handler } = await import(handlerUrl);
    assert.equal(await handler(), undefined);
  `,
    { env: { DD_LOG_LEVEL: "debug" } },
  );
  assert.match(output, /failed to register dd-trace ESM loader hooks/);
  assert.match(output, /missing-internal-dependency/);
});

for (const level of [undefined, "error", "debug", "DeBuG"]) {
  test(`startup logging honors DD_LOG_LEVEL=${level}`, () => {
    const output = fixture().run("await import(handlerUrl);", { env: level ? { DD_LOG_LEVEL: level } : {} });
    assert.equal(output.includes("datadog:automatically initialized dd-trace"), level?.toLowerCase() === "debug");
    assert.equal(output.includes("datadog:registered dd-trace ESM loader hooks"), level?.toLowerCase() === "debug");
  });
}

test("explicit debugLogging and a custom logger override the environment", () => {
  fixture().run(
    `
    const shim = require('datadog-lambda-js');
    const { logDebug } = require('datadog-lambda-js/dist/utils');
    const messages = [];
    const logger = { debug: message => messages.push(JSON.parse(message)), error() {}, warn() {} };
    shim.datadog(() => {}, { debugLogging: false, logger });
    logDebug('suppressed');
    assert.equal(messages.length, 0);
    shim.datadog(() => {}, { debugLogging: true });
    logDebug('visible');
    assert.equal(messages[0].message, 'datadog:visible');
  `,
    { env: { DD_LOG_LEVEL: "debug" } },
  );
});

for (const telemetryFails of [false, true]) {
  test(`init failure retains the load start and original error (telemetry rejects: ${telemetryFails})`, () => {
    const setup = fixture();
    write(join(setup.directory, "customer.mjs"), "Date.now = () => 9000; throw globalThis.customerFailure;");
    setup.run(
      `
      Date.now = () => 1000;
      globalThis.customerFailure = new Error('customer initialization failed');
      const shim = require('datadog-lambda-js');
      const errors = [];
      shim.setLogger({ debug() {}, warn() {}, error: message => errors.push(JSON.parse(message)) });
      await assert.rejects(import(handlerUrl), error => error === globalThis.customerFailure);
      assert.equal(globalThis.initFailure.startTime, 1000);
      assert.equal(globalThis.initFailure.error, globalThis.customerFailure);
      assert.equal(globalThis.initFailure.functionName, 'customer.handler');
      assert.equal(errors.length, ${telemetryFails ? 1 : 0});
      ${
        telemetryFails
          ? `assert.equal(errors[0].message, 'datadog:failed to report handler load failure');
        assert.equal(errors[0].error.message, 'telemetry failed');`
          : ""
      }
    `,
      { env: telemetryFails ? { FAIL_TELEMETRY: "1" } : {} },
    );
  });
}
