# `datadog-lambda-js` — final-state preview

A buildable sketch of what this package looks like once everything that *can*
move into dd-trace has moved. **Not wired into any build or release.** Built to
answer one question concretely instead of in prose.

Read [`DESIGN.md`](DESIGN.md) first — it has the reasoning and the three design
decisions, all now resolved. [`DELETED.md`](DELETED.md) is the file-by-file
destination map.

## The shape

```
src/
  handler.mjs             75   entry point: ordering, tracer init, loader registration
  index.ts               187   public API — every function forwards
  facade.ts              134   the ONLY module that knows dd-trace exists
  constants.ts            13   version stamp + streaming symbols
  runtime/
    user-function.ts     237   DD_LAMBDA_HANDLER resolution, CJS/ESM/TLA loading
    errors.ts            136   AWS-compatible runtime error classes
    module_importer.js    76   tracer init + ESM loader hook registration
    index.ts               1
  utils/
    log.ts                76   the shim's own logging
    index.ts               1
```

**865 lines kept. 5,856 lines (60 files) leave.**

## What was verified

Everything below was run, not assumed.

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `npm run build` emits `dist/` | TypeScript output plus the handler and runtime importer |
| Export surface vs today's shim | 36 exports, **1 removal**, 3 additive |
| `node scripts/check_api_surface.js` | passes against `dist/` |
| Runtime dependencies | 5 → 1 |

`serialize-error` is the one remaining dependency. Correction to an earlier
claim of mine: it is **not** protected by the goldens — all 24 contain zero
shim `datadog:` log records. It stays only because `log.ts` survives, with one
fix to how it records errors (see `DESIGN.md`).

The single removal is `_metricsQueue` — underscore-prefixed, private by
convention, and now owned by dd-trace. Keeping it would mean exporting a queue
that nothing drains, which is exactly the kind of live-looking dead object worth
deleting in a major. It is recorded in `api-surface.json` under
`intentionallyRemoved`, so the guard fails if it silently comes back.

The three additions (`setLogger`, `setLogLevel`, `LogLevel`) are additive and
close a real gap: the parity ledger lists them as public shim exports, but
today's `src/index.ts` does not actually re-export them — customers have to
reach into `datadog-lambda-js/dist/utils`. Worth fixing either way.

## How to build it yourself

The preview has no `node_modules` of its own; point it at the real repo's:

```bash
ln -s ../datadog-lambda-js/node_modules node_modules
npm run build
npm run test:api-surface
npm test
```

The build copies `src/handler.mjs` and `src/runtime/module_importer.js` unchanged;
TypeScript does not emit them. `npm test` packs that build and tests the extracted
package in fresh Node processes, with fixture tracer installations. It checks
packaging, CJS/ESM loading, local-versus-layer tracer selection, hook registration,
startup logging, and init-failure timing/error preservation. These focused tests
do not replace the real-tracer compatibility suite or the Lambda goldens.

For embedded runtimes that ignore `NODE_OPTIONS`, use `--require dd-trace/register.js`
or `--import dd-trace/initialize.mjs`. The shim loads the selected tracer's same
entry point explicitly, relying on Node's module cache to avoid duplicate hooks,
and waits before importing the customer handler. Legacy `--loader` settings still
use the launch configuration as evidence of registration to preserve existing
behavior; ignored legacy `--loader` settings are not covered by this fix.

## What this preview does NOT include

Deliberately out of scope, because they are unchanged in *kind* and large in
volume — listing them is more useful than copying them:

- `Dockerfile`, `scripts/build_layers.sh`, `scripts/publish_*.sh`,
  `scripts/check_layer_size.sh`, `scripts/create_documentation_pr.sh`,
  `.gitlab-ci.yml` — the release machinery, which is the third reason this
  package survives at all.
- `scripts/move_ddtrace_dependency.js` — needs the per-runtime change (v5.x for
  Node 18/20, v6.x for 22/24/26) described in ROADMAP PR 17.
- `integration_tests_local/**` — the golden harness. ROADMAP PR 19 moves the
  permanent suite into dd-trace-js once it is green; the layer/npm/manual
  fixtures stay here.
- The full legacy unit suite. `src/runtime/user-function.ts` and `errors.ts`
  arrive verbatim, so their existing specs still need porting. The focused
  package/runtime regression suite above is included now.

## Honest caveat

`facade.ts` assumes a five-function `dd-trace/lambda`. The fifth
(`reportInitFailure`) is now reserved on the facade — decision A resolved in
its favor — but as a throwing stub until the metrics pipeline lands (PR 12).
So this preview compiles and its surface checks out, but it would not *run*
against today's dd-trace. That is the point of the preview: it shows what
dd-trace still owes the shim.
