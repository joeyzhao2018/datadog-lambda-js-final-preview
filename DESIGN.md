# What `datadog-lambda-js` is after the migration

**Preview only.** Nothing here is wired into a build or a release. It answers one
question: when everything that *can* move to dd-trace has moved, what is left?

## The one-sentence answer

> The shim becomes an **entry point and a packaging unit**, not a tracer.
> It decides *when and how* the customer's handler is loaded and wrapped;
> dd-trace decides *what happens* when it runs.

## Why it still exists

Three reasons, from `migration_strategy.md`:

1. **We cannot break existing setups.** The layer handler path, the npm handler
   path, `datadog(handler)`, and every exported constant are a public contract
   consumed by onboarding tooling, the Serverless Framework plugin and the CDK
   constructs.
2. **Some logic genuinely belongs here.** Ordering and module resolution — see
   below; this is not a courtesy, it is a hard constraint.
3. **Releases.** dd-trace-java and dd-trace-dotnet both ended up rebuilding a
   release repo after deprecating their Lambda libraries. The GitLab machinery
   already lives here.

## The four responsibilities

### 1. Entry points and ordering — `src/handler.mjs`, `src/runtime/`

The irreducible core. Two constraints pin it here:

- **dd-trace's npm production code may not use promises or `async`/`await`**
  (dd-trace `AGENTS.md`). Loading an ESM handler is inherently async; note the
  top-level `await load(...)`.
- **The tracer must be initialized, and its ESM loader hooks registered, before
  the handler module is evaluated.** A dd-trace plugin cannot do this: it is
  loaded *by* the very thing it would need to precede.

Owns: `DD_LAMBDA_HANDLER` resolution (nested dirs, extensions, `type: module`),
CJS/ESM/top-level-await loading, `Module.register` + the double-registration
guard, `DD_TRACE_EXTRACTOR` loading, tracer-init ordering, and any future
ordering-critical environment registration that must precede customer-module
evaluation (this is where a revived durable-execution `Path B` would live).

### 2. Public API compatibility — `src/index.ts`, `src/facade.ts`

500 lines become ~130, all forwarding. `src/facade.ts` is the **only** module
that knows dd-trace exists. That isolation is deliberate: one shim version is
paired with two tracer majors, so the coupling gets exactly one audited file
with a version check that fails loudly at load rather than mid-invocation.

### 3. Handler-load failure telemetry — `emitTelemetryOnErrorOutsideHandler`

Stays shim-*detected* because the failure happens during module evaluation:
there is no invocation for dd-trace's lifecycle to observe. But it is
dd-trace-*rendered* — see decision A below.

### 4. Release and packaging — `scripts/`, `Dockerfile`

Unchanged in scope: layer layout, names, signing, GovCloud, size gate, docs
automation, and the shim-version-to-layer-version mapping. One change: the
dd-trace version is resolved **per runtime** (v5.x for Node 18/20, v6.x for
22/24/26).

## What leaves

~6,000 of 6,933 source lines. Everything in `src/trace/**`, `src/metrics/**`,
`src/appsec/**`, plus the business utilities (`span-pointers`, `arn`,
`tag-object`, `event-type-guards`, `event-validator`, `cold-start`, `timer`,
`handler`, `request`, `dd_tags`, `batch-item-failures`) and
`src/runtime/require-tracer.ts`.

See `DELETED.md` for the file-by-file destination map.

## Dependency effect

| | Before | After |
|---|---|---|
| Runtime dependencies | 5 | 1 |
| | `@aws-crypto/sha256-js`, `dc-polyfill`, `promise-retry`, `serialize-error`, `shimmer` | `serialize-error` |

`serialize-error` stays because `src/utils/log.ts` survives and there is no
reason to rewrite its serializer. Note what that reason is *not*: shim log
output is **not** golden-protected. All 24 L2 goldens contain zero `datadog:`
records, because the shim's default log level is `ERROR` and no L2 case sets
`DD_LOG_LEVEL=debug`. So this dependency could be dropped with a short inline
serializer; the only exposure is unobserved drift in `logError(message, error)`
output. The other four leave with the code that used them, which is real
headroom against the 9 MB / 24 MB layer size gate.

**Unprotected surface, worth a ledger row:** no golden asserts the shim's own
log output. The goldens protect `src/metrics/metric-log.ts` records (the
`{"e","m","t","v"}` objects in `manual-send-metrics.log`, which sets
`DD_FLUSH_TO_LOG=true`) — and that file moves to dd-trace.

That gap had already hidden two bugs, fixed here. `logError(message, error)`
spread the serialized error over the record, so the error's `message` replaced
the shim's: `logError("failed to flush metrics", e)` logged only `e.message`.
And an `Error` passed inside metadata (`{ error }`) stringified as `{}`, losing
its message and stack. Records now keep the shim's `message` and put the error
under an `error` key, serialized wherever it appears. Upstream's `log.spec.ts`
asserts the old shape, so its expectations change when it is ported.

## The internal Lambda bridge contract

Five functions, identical on `master` / `v6.x` / `v5.x`, asserted against the
packed tarball on all three lines:

```ts
wrap(handler, config?)                                    // the lifecycle
sendDistributionMetric(name, value, ...tags)              // custom metrics
sendDistributionMetricWithDate(name, value, date, ...tags)
getTraceHeaders()                                         // exactly 3 keys
reportInitFailure({ error, functionName, startTime })     // see below
```

## Decisions

These are judgement calls, not oversights. Each changes the shape of the result.

### A. Resolved: the facade grows a fifth function

`emitTelemetryOnErrorOutsideHandler` currently constructs a span through
`TracerWrapper`/`SpanWrapper` and an error metric through
`MetricsListener`/`KMSService` — all four of which PR 20 deletes. So it must be
re-expressed. **Decided (round 7): option 1 — `reportInitFailure` on the facade.**
Keeps span shape and metric emission in dd-trace, where every other span and
metric lives. Reserved on the cross-major contract from PR 4 (throwing stub),
implemented with the metrics pipeline (PR 12), before any shim release depends
on it. The rejected alternative — the shim hand-building span tags via
dd-trace's public tracer API — would put span-tag construction back in the
shim, which is the thing the migration is trying to end.

### B. Resolved: one shim line, dual range

`peerDependencies: ^5.126.0 || ^6.12.0`, spanning both majors, is correct — and
this is the permanent shape, not a transitional hack. When v7 ships it becomes
`^6 || ^7` for the same reason.

The reason it works is the ROADMAP's Backport Rule: every PR touching the plugin
path or the facade lands on `master` **and is cherry-picked to `v6.x` and `v5.x`
in the same change set**. So `v5.x` carries the migrated plugin and the same
five-function facade. The facade is *designed* to be identical across majors,
and an API-surface test asserts that on all three lines. There is no version of
this where v5 lacks the code.

The residual risk is narrower than "v5 might not have it": **npm does not use
`engines` to select versions.** Given `^5 || ^6` on Node 18, npm picks the
highest satisfying version — a v6 that declares `engines.node >= 22` — emits an
`EBADENGINE` *warning* rather than an error, installs it, and then dd-trace's
guardrail refuses to instrument. The result is a silent no-op tracer.

That exposure is limited to **npm-install users on Node 18/20**. Layer users are
unaffected: the layer resolves dd-trace per runtime and never consults npm. The
guard is already in the ROADMAP — `engines.node >= 18` on the shim plus the
Node 18 install test, which is what makes the silent failure loud in CI.

### C. Resolved: `setLogger` stays shim-only

`setLogger` / `setLogLevel` / `LogLevel` / `Logger` are exported and used. The
shim still needs its own logging for handler resolution and loader registration,
so `log.ts` survives. **Decided: `setLogger` does not forward into dd-trace's
logger.** It sets the logger for the shim's own logs, exactly as in 12.x, which
never handed a logger to dd-trace either. No sixth facade function, no dd-trace
work. `datadog(handler, { logger })` still passes its whole config to `wrap()`,
but dd-trace does not read `logger` from it.

What that means in practice:

- **`setLogger` covers less than it used to.** Roughly 100 of the current
  shim's ~115 log calls are in `src/trace/**`, `src/metrics/**` and
  `src/appsec/**`, all of which move to dd-trace. After the migration a custom
  logger sees only handler resolution and loader registration. The moved
  messages become dd-trace's, and go to the console.
- **The real-world impact is small.** dd-trace logs nothing unless
  `DD_TRACE_DEBUG` is set, and in Lambda its console output lands in the same
  CloudWatch log group, just not in the customer's format.
- **The workaround is partial.** Customers who initialize dd-trace themselves
  can pass `tracer.init({ logger })`. Anyone relying on the shim to initialize
  it, which includes every layer user, cannot: the shim calls `init()` without a
  logger, and a second call is a no-op.

The rejected alternative was a sixth facade function, `setLogger(logger)`, so
one call routes both. It costs a cross-major contract change on `master`,
`v6.x` and `v5.x`, and dd-trace would have to keep the forwarded logger alive
across `log.configure()`, which resets it on every `Config` construction. That
is too much for logs that are silent by default. Revisit if customers ask.

**A separate gap that forwarding would not have fixed.** About 10 of the moving
calls are `logError`: "failed to flush metrics", "couldn't decrypt kms api key",
"Unable to extract trace context. Custom extractor function failed", and
others. They print by default today because the shim's default level is
`ERROR`. Ported as dd-trace `log.error`, which is how the migrated Lambda code
logs now, they print nothing unless `DD_TRACE_DEBUG` is set. So a misconfigured
KMS key goes from a visible CloudWatch error to silence. That is a
log-visibility question for PR 12 and the parity ledger, not a logger-routing
one.
