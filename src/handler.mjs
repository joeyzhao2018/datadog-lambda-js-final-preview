import {
  datadog,
  datadogHandlerEnvVar,
  lambdaTaskRootEnvVar,
  traceExtractorEnvVar,
  getEnvValue,
  emitTelemetryOnErrorOutsideHandler,
} from "./index.js";
import { logDebug, logError } from "./utils/index.js";
import { load } from "./runtime/index.js";
import { initTracer } from "./runtime/module_importer.js";

// This file is the reason datadog-lambda-js still exists.
//
// Everything below is ordering and module resolution: work that has to happen
// before the customer's module is evaluated, and that cannot move into
// dd-trace. Two hard constraints keep it here:
//
//   1. dd-trace's npm production code may not use promises or async/await
//      (dd-trace AGENTS.md). Loading an ESM handler is inherently async — note
//      the top-level `await load(...)` below.
//   2. The tracer must be initialized, and its ESM loader hooks registered,
//      strictly before the handler module is imported. A dd-trace plugin runs
//      too late by construction: it is loaded *by* the thing it would need to
//      precede.
//
// Keep this file boring. Behaviour belongs in dd-trace; sequencing belongs here.

if (process.env.DD_TRACE_STARTUP_LOGS === undefined) {
  process.env.DD_TRACE_STARTUP_LOGS = "false";
  logDebug("disabled dd-trace startup logs");
}

// `DD_TRACE_DISABLED_PLUGINS = "fs"` is intentionally NOT set here anymore: the
// dd-trace Lambda plugin owns that default (packages/datadog-plugin-aws-lambda/
// src/defaults.js). The dependency floor in package.json is what guarantees the
// tracer is new enough to apply it — without that floor, an older tracer would
// silently re-enable fs instrumentation.

if (getEnvValue("DD_TRACE_ENABLED", "true").toLowerCase() === "true") {
  await initTracer();
}

const taskRootEnv = getEnvValue(lambdaTaskRootEnvVar, "");
const handlerEnv = getEnvValue(datadogHandlerEnvVar, "");
const extractorEnv = getEnvValue(traceExtractorEnvVar, "");
let traceExtractor;

if (extractorEnv) {
  try {
    traceExtractor = await load(taskRootEnv, extractorEnv);
    logDebug("loaded custom trace context extractor", { extractorEnv });
  } catch (error) {
    logError("an error occurred while loading the custom trace context extractor", { error, extractorEnv });
  }
}

// Taken before loading, so the failure span covers the customer module's own
// initialization rather than only the moment it threw.
const handlerLoadStart = Date.now();
let wrappedHandler;
try {
  wrappedHandler = datadog(await load(taskRootEnv, handlerEnv), { traceExtractor });
} catch (error) {
  // Telemetry must never replace the customer's error: theirs is the one Lambda
  // reports, and the only clue to why their module failed to load.
  try {
    await emitTelemetryOnErrorOutsideHandler(error, handlerEnv, handlerLoadStart);
  } catch (telemetryError) {
    logError("failed to report handler load failure", { handlerEnv }, telemetryError);
  }
  throw error;
}

export const handler = wrappedHandler;
