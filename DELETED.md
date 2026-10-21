# Where every deleted file goes

60 source files, **5856 lines**, leave the shim.
What remains: 10 files, **865 lines** (plus loader fixtures).

Deletion happens in PR 20, only after every parity row is `verified`.

| File | Lines | Destination |
|---|---|---|
| `src/appsec/event-data-extractor.ts` | 215 | dd: datadog-plugin-aws-lambda/src/appsec.js (PR 13) |
| `src/appsec/headers.ts` | 35 | dd: datadog-plugin-aws-lambda/src/appsec.js (PR 13) |
| `src/appsec/index.ts` | 59 | dd: datadog-plugin-aws-lambda/src/appsec.js (PR 13) |
| `src/init.js` | 2 | review |
| `src/metrics/api.ts` | 41 | dd: metrics modules (PR 12) |
| `src/metrics/batcher.ts` | 37 | dd: metrics modules (PR 12) |
| `src/metrics/dogstatsd.ts` | 130 | dd-core: dd-trace/src/dogstatsd.js (PR 12) — extend, no private client |
| `src/metrics/enhanced-metrics.ts` | 107 | dd: datadog-plugin-aws-lambda/src/enhanced-metrics.js (PR 12) |
| `src/metrics/extension.ts` | 45 | dd: metrics modules (PR 12) |
| `src/metrics/index.ts` | 4 | dd: metrics modules (PR 12) |
| `src/metrics/kms-service.ts` | 90 | dd: metrics modules (PR 12) |
| `src/metrics/listener.ts` | 252 | dd: metrics modules (PR 12) — one queue, one flush barrier |
| `src/metrics/metric-log.ts` | 22 | dd: metrics modules (PR 12) |
| `src/metrics/model.ts` | 72 | dd: metrics modules (PR 12) |
| `src/metrics/processor.ts` | 105 | dd: metrics modules (PR 12) |
| `src/metrics/queue.ts` | 58 | dd: metrics modules (PR 12) |
| `src/runtime/require-tracer.ts` | 62 | dd: datadog-plugin-aws-lambda/src/cold-start.js (PR 15) — must subscribe during tracer init |
| `src/trace/cold-start-tracer.ts` | 112 | dd: datadog-plugin-aws-lambda/src/cold-start-tracer.js (PR 15) |
| `src/trace/constants.ts` | 3 | dd: datadog-plugin-aws-lambda/src/… (PR 7-10) |
| `src/trace/context/extractor-utils.ts` | 62 | dd: datadog-plugin-aws-lambda/src/… (PR 7-10) |
| `src/trace/context/extractor.ts` | 134 | dd: datadog-plugin-aws-lambda/src/… (PR 7-10) |
| `src/trace/context/extractors/app-sync.ts` | 18 | dd: datadog-plugin-aws-lambda/src/… (PR 7-10) |
| `src/trace/context/extractors/custom.ts` | 25 | dd: datadog-plugin-aws-lambda/src/… (PR 7-10) |
| `src/trace/context/extractors/durable-execution.ts` | 105 | dd: datadog-plugin-aws-lambda/src/… (PR 7-10) |
| `src/trace/context/extractors/event-bridge-sqs.ts` | 66 | dd: datadog-plugin-aws-lambda/src/… (PR 7-10) |
| `src/trace/context/extractors/event-bridge.ts` | 34 | dd: datadog-plugin-aws-lambda/src/… (PR 7-10) |
| `src/trace/context/extractors/http.ts` | 101 | dd: datadog-plugin-aws-lambda/src/… (PR 7-10) |
| `src/trace/context/extractors/index.ts` | 12 | dd: datadog-plugin-aws-lambda/src/… (PR 7-10) |
| `src/trace/context/extractors/kinesis.ts` | 77 | dd: datadog-plugin-aws-lambda/src/… (PR 7-10) |
| `src/trace/context/extractors/lambda-context.ts` | 31 | dd: datadog-plugin-aws-lambda/src/… (PR 7-10) |
| `src/trace/context/extractors/sns-sqs.ts` | 94 | dd: datadog-plugin-aws-lambda/src/… (PR 7-10) |
| `src/trace/context/extractors/sns.ts` | 83 | dd: datadog-plugin-aws-lambda/src/… (PR 7-10) |
| `src/trace/context/extractors/sqs.ts` | 84 | dd: datadog-plugin-aws-lambda/src/… (PR 7-10) |
| `src/trace/context/extractors/step-function.ts` | 20 | dd: datadog-plugin-aws-lambda/src/… (PR 7-10) |
| `src/trace/durable-function-context.ts` | 65 | dd: datadog-plugin-aws-lambda/src/extractors/durable-execution.js (PR 8) — unify with datadog-plugin-aws-durable-execution-sdk-js/src/trace-checkpoint.js |
| `src/trace/index.ts` | 2 | dd: datadog-plugin-aws-lambda/src/… (PR 7-10) |
| `src/trace/listener.ts` | 404 | dd: datadog-plugin-aws-lambda/src/index.js (PR 6/9) — dissolved into the plugin lifecycle |
| `src/trace/patch-console.ts` | 128 | dd: datadog-plugin-aws-lambda/src/console-patcher.js (PR 7) |
| `src/trace/patch-http.ts` | 150 | dropped — dd-trace http/https plugins |
| `src/trace/span-context-wrapper.ts` | 78 | dropped — dd-trace core SpanContext |
| `src/trace/span-inferrer.ts` | 590 | dd: datadog-plugin-aws-lambda/src/span-inferrer.js (PR 9) |
| `src/trace/span-wrapper.ts` | 39 | dropped — dd-trace core Span |
| `src/trace/step-function-service.ts` | 281 | dd: datadog-plugin-aws-lambda/src/step-function-service.js (PR 9) |
| `src/trace/trace-context-service.ts` | 91 | dd: datadog-plugin-aws-lambda/src/trace-context-extractor.js (PR 8) |
| `src/trace/tracer-wrapper.ts` | 169 | dropped — dd-trace core tracer API |
| `src/trace/trigger.ts` | 402 | dd: datadog-plugin-aws-lambda/src/trigger.js (PR 7) |
| `src/trace/xray-service.ts` | 222 | dd: datadog-plugin-aws-lambda/src/xray-service.js (PR 10) |
| `src/utils/arn.ts` | 55 | dd: datadog-plugin-aws-lambda/src/… (PR 7) |
| `src/utils/batch-item-failures.ts` | 12 | dd: enhanced-metrics.js (PR 12) |
| `src/utils/cold-start.ts` | 67 | dd: datadog-plugin-aws-lambda/src/cold-start.js (PR 15) |
| `src/utils/dd_tags.ts` | 12 | dropped — _dd.origin is set on the span by the plugin |
| `src/utils/event-type-guards.ts` | 122 | dd: datadog-plugin-aws-lambda/src/… (PR 7) |
| `src/utils/event-validator.ts` | 81 | dd: datadog-plugin-aws-lambda/src/… (PR 7) |
| `src/utils/fips.ts` | 13 | dd: datadog-plugin-aws-lambda/src/… (PR 7) |
| `src/utils/handler.ts` | 105 | dd: datadog-plugin-aws-lambda/src/handler-utils.js (PR 6) — already ported |
| `src/utils/process-version.ts` | 3 | dd: datadog-plugin-aws-lambda/src/… (PR 7) |
| `src/utils/request.ts` | 102 | dd: datadog-plugin-aws-lambda/src/… (PR 7) |
| `src/utils/span-pointers.ts` | 146 | dd: datadog-plugin-aws-lambda/src/span-pointers.js (PR 11) — reuse datadog-plugin-aws-sdk/src/util.js hashes |
| `src/utils/tag-object.ts` | 48 | dd: datadog-plugin-aws-lambda/src/… (PR 7) |
| `src/utils/timer.ts` | 72 | dd: datadog-plugin-aws-lambda/src/… (PR 7) |
