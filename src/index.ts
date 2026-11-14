import { Context, Handler } from "aws-lambda";

import { getLambdaFacade, LambdaConfig, TraceHeaders } from "./facade";
import { Logger, LogLevel, setLogger, setLogLevel } from "./utils";

// Backwards-compatible type export, TODO deprecate in next major.
export { TraceHeaders };
export { Logger, LogLevel, setLogger, setLogLevel } from "./utils";

// ---------------------------------------------------------------------------
// Environment-variable constants.
//
// These stay here because they are part of the published surface: onboarding
// tooling, the Serverless Framework plugin and the CDK constructs import them
// by name. dd-trace owns what the variables *do*; the shim owns their spelling.
// ---------------------------------------------------------------------------
export const apiKeyEnvVar = "DD_API_KEY";
export const apiKeyKMSEnvVar = "DD_KMS_API_KEY";
export const apiKeySecretARNEnvVar = "DD_API_KEY_SECRET_ARN";
export const captureLambdaPayloadEnvVar = "DD_CAPTURE_LAMBDA_PAYLOAD";
export const captureLambdaPayloadMaxDepthEnvVar = "DD_CAPTURE_LAMBDA_PAYLOAD_MAX_DEPTH";
export const traceManagedServicesEnvVar = "DD_TRACE_MANAGED_SERVICES";
export const siteURLEnvVar = "DD_SITE";
export const logLevelEnvVar = "DD_LOG_LEVEL";
export const logForwardingEnvVar = "DD_FLUSH_TO_LOG";
export const logInjectionEnvVar = "DD_LOGS_INJECTION";
export const enhancedMetricsEnvVar = "DD_ENHANCED_METRICS";
export const datadogHandlerEnvVar = "DD_LAMBDA_HANDLER";
export const lambdaTaskRootEnvVar = "LAMBDA_TASK_ROOT";
export const mergeXrayTracesEnvVar = "DD_MERGE_XRAY_TRACES";
export const traceExtractorEnvVar = "DD_TRACE_EXTRACTOR";
export const defaultSiteURL = "datadoghq.com";
export const encodeAuthorizerContextEnvVar = "DD_ENCODE_AUTHORIZER_CONTEXT";
export const decodeAuthorizerContextEnvVar = "DD_DECODE_AUTHORIZER_CONTEXT";
export const coldStartTracingEnvVar = "DD_COLD_START_TRACING";
export const minColdStartTraceDurationEnvVar = "DD_MIN_COLD_START_DURATION";
export const coldStartTraceSkipLibEnvVar = "DD_COLD_START_TRACE_SKIP_LIB";
export const localTestingEnvVar = "DD_LOCAL_TESTING";
export const addSpanPointersEnvVar = "DD_TRACE_AWS_ADD_SPAN_POINTERS";
export const dataStreamsEnabledEnvVar = "DD_DATA_STREAMS_ENABLED";
export const appsecEnabledEnvVar = "DD_APPSEC_ENABLED";

// Applied at import, not in `datadog()`: the layer's startup logs (tracer init,
// loader registration, extractor loading) all run before the handler is
// wrapped. Same reading as 12.x — only "debug" turns debug logs on — and an
// explicit `debugLogging` passed to `datadog()` still wins.
if (getEnvValue(logLevelEnvVar, "ERROR").toLowerCase() === "debug") {
  setLogLevel(LogLevel.DEBUG);
}

interface GlobalConfig {
  /** Whether to log extra information. @default false */
  debugLogging: boolean;
  /** Whether to force the `datadog()` wrapper to always wrap. @default false */
  forceWrap: boolean;
  /** Custom logger used by the shim-owned loader and failure path. */
  logger?: Logger;
}

/**
 * Configuration options for Datadog's Lambda wrapper.
 *
 * Every field is forwarded to dd-trace, which owns the behaviour and the
 * environment-variable fallbacks. Fields are kept optional and additive: this
 * type is a compatibility surface, so a field is never removed in a minor.
 */
export type Config = Partial<LambdaConfig> & Partial<GlobalConfig>;

/**
 * Wraps an AWS Lambda handler to add Datadog tracing and metrics.
 *
 * The heavy lifting happens in dd-trace. This function exists so that
 * `import { datadog } from "datadog-lambda-js"` keeps working, and so that
 * manual wrapping stays a supported entry point alongside the layer.
 *
 * ```javascript
 * const { datadog } = require("datadog-lambda-js");
 * exports.handler = datadog(async (event) => ({ statusCode: 200 }));
 * ```
 */
export function datadog<TEvent, TResult>(
  handler: Handler<TEvent, TResult> | any,
  config?: Config,
): Handler<TEvent, TResult> | any {
  // Applied before delegating so that shim-owned logs (handler resolution,
  // loader registration) honour the caller's intent too, not just dd-trace's.
  if (config?.debugLogging !== undefined) {
    setLogLevel(config.debugLogging ? LogLevel.DEBUG : LogLevel.ERROR);
  }
  if (config?.logger !== undefined) {
    setLogger(config.logger);
  }

  return getLambdaFacade().wrap(handler, config);
}

/** Submits a custom distribution metric. */
export function sendDistributionMetric(name: string, value: number, ...tags: string[]): void {
  getLambdaFacade().sendDistributionMetric(name, value, ...tags);
}

/** Submits a custom distribution metric with an explicit timestamp. */
export function sendDistributionMetricWithDate(name: string, value: number, metricTime: Date, ...tags: string[]): void {
  getLambdaFacade().sendDistributionMetricWithDate(name, value, metricTime, ...tags);
}

/**
 * The historical default configuration.
 *
 * dd-trace owns the live defaults now, so this is a frozen record of the values
 * the shim used to apply, kept because `datadog(handler, { ...defaultConfig, x })`
 * is a documented pattern. Reading it is safe; it no longer drives behaviour.
 */
export const defaultConfig: Config = {
  apiKey: "",
  apiKeyKMS: "",
  apiKeySecretARN: "",
  captureLambdaPayload: false,
  captureLambdaPayloadMaxDepth: 10,
  createInferredSpan: true,
  debugLogging: false,
  encodeAuthorizerContext: true,
  decodeAuthorizerContext: true,
  enhancedMetrics: true,
  forceWrap: false,
  injectLogContext: true,
  logForwarding: false,
  mergeDatadogXrayTraces: false,
  siteURL: "",
  minColdStartTraceDuration: 3,
  coldStartTraceSkipLib: "",
  localTesting: false,
  addSpanPointers: true,
  dataStreamsEnabled: false,
  appsecEnabled: false,
};

/**
 * Splits Lambda handler arguments into their named parts.
 *
 * Kept because handler-loading integrations import it. Pure and cheap, so there
 * is no reason to make callers reimplement it.
 */
export function extractArgs<TEvent>(isResponseStreamFunction: boolean, ...args: any[]) {
  const context: Context = isResponseStreamFunction
    ? args[2]
    : args.length > 0
    ? (args[1] as Context)
    : ({} as Context);
  const event: TEvent = args[0];
  const responseStream: any = isResponseStreamFunction ? args[1] : undefined;
  return { context, event, responseStream };
}

/** Returns the Datadog propagation headers for the active invocation. */
export function getTraceHeaders(): Partial<TraceHeaders> {
  return getLambdaFacade().getTraceHeaders();
}

/**
 * Reads one environment value.
 *
 * Retained because `handler.mjs` needs it before dd-trace is initialized, and
 * because it has always been exported.
 */
export function getEnvValue(key: string, defaultValue: string): string {
  const value = process.env[key];
  return value !== undefined ? value : defaultValue;
}

/**
 * Reports a handler that could not be loaded.
 *
 * Shim-owned because the failure happens during module evaluation, before any
 * invocation reaches dd-trace's lifecycle — there is no invocation to hang the
 * error off, so dd-trace cannot observe this on its own. The shim detects it
 * and dd-trace renders it.
 */
export async function emitTelemetryOnErrorOutsideHandler(
  error: Error,
  functionName: string,
  startTime: number,
): Promise<void> {
  await getLambdaFacade().reportInitFailure({ error, functionName, startTime });
}
