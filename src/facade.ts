import { Context, Handler } from "aws-lambda";
import { createRequire } from "node:module";

import { resolveTracerPath } from "./runtime/tracer";

/**
 * The Datadog propagation headers returned by `getTraceHeaders()`.
 *
 * Pinned to exactly these three keys. Customers forward this object to
 * downstream services, so adding dd-trace's W3C carriers here would be a
 * visible contract change.
 */
export interface TraceHeaders {
  "x-datadog-trace-id": string;
  "x-datadog-parent-id": string;
  "x-datadog-sampling-priority": string;
}

/** The custom extractor result accepted by datadog-lambda-js. */
export interface TraceContext {
  /** @deprecated use `traceId` */
  traceID?: string;
  /** @deprecated use `parentId` */
  parentID?: string;
  traceId?: string;
  parentId?: string;
  sampleMode: -1 | 0 | 1 | 2;
  source: "xray" | "event" | "ddtrace";
}

export type TraceExtractor = (event: any, context: Context) => Promise<TraceContext> | TraceContext;

/**
 * Per-handler configuration accepted by `datadog()`.
 *
 * dd-trace owns every default and every environment-variable fallback; values
 * passed here are programmatic overrides layered on top. Names are the legacy
 * shim spellings, preserved for compatibility — the facade maps them.
 */
export interface LambdaConfig {
  apiKey: string;
  apiKeyKMS: string;
  apiKeySecretARN: string;
  captureLambdaPayload: boolean;
  captureLambdaPayloadMaxDepth: number;
  createInferredSpan: boolean;
  encodeAuthorizerContext: boolean;
  decodeAuthorizerContext: boolean;
  enhancedMetrics: boolean;
  injectLogContext: boolean;
  logForwarding: boolean;
  mergeDatadogXrayTraces: boolean;
  minColdStartTraceDuration: number;
  coldStartTraceSkipLib: string;
  localTesting: boolean;
  addSpanPointers: boolean;
  dataStreamsEnabled: boolean;
  appsecEnabled: boolean;
  siteURL: string;
  forceWrap: boolean;
  /** Custom trace-context extractor, optionally loaded by `DD_TRACE_EXTRACTOR`. */
  traceExtractor: TraceExtractor;
}

/** Details of a handler that could not be loaded. */
export interface InitFailure {
  error: Error;
  functionName: string;
  /** `Date.now()` at the start of module evaluation. */
  startTime: number;
}

/**
 * The internal Lambda bridge used only by datadog-lambda-js.
 *
 * This surface is identical on dd-trace `master`, `v6.x` and `v5.x`, and is
 * asserted against the packed tarball on all three lines. It is the only thing
 * this package knows about dd-trace's internals — deliberately, because the
 * layer pairs a single shim version with two different tracer majors.
 */
export interface LambdaFacade {
  wrap<TEvent, TResult>(
    handler: Handler<TEvent, TResult> | any,
    config?: Partial<LambdaConfig>,
  ): Handler<TEvent, TResult> | any;
  sendDistributionMetric(name: string, value: number, ...tags: string[]): void;
  sendDistributionMetricWithDate(name: string, value: number, metricTime: Date, ...tags: string[]): void;
  getTraceHeaders(): Partial<TraceHeaders>;
  reportInitFailure(failure: InitFailure): Promise<void>;
}

/** Tracer versions that provide the internal Lambda bridge. */
export const REQUIRED_DD_TRACE = "^5.x (Node 18/20) or ^6.x (Node 22+)";

const FACADE_MODULE = "./packages/dd-trace/src/lambda/facade";
const REQUIRED_METHODS: (keyof LambdaFacade)[] = [
  "wrap",
  "sendDistributionMetric",
  "sendDistributionMetricWithDate",
  "getTraceHeaders",
  "reportInitFailure",
];

let facade: LambdaFacade | undefined;

/**
 * Resolves the dd-trace Lambda facade.
 *
 * Deliberately lazy: tooling imports this package purely for its env-var
 * constants, and that must not pull in the tracer.
 *
 * Resolution order matches `initTracer`: a function-local dd-trace wins over
 * the layer's copy, so a customer who pins their own tracer version gets it.
 */
export function getLambdaFacade(): LambdaFacade {
  if (facade !== undefined) {
    return facade;
  }

  let resolved: LambdaFacade;
  try {
    const tracerRequire = createRequire(resolveTracerPath());
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    resolved = tracerRequire(FACADE_MODULE);
  } catch (error) {
    throw new Error(
      `datadog-lambda-js could not load "${FACADE_MODULE}". ` +
        `Install dd-trace ${REQUIRED_DD_TRACE} alongside datadog-lambda-js, ` +
        `or use the Datadog Lambda layer, which bundles a matching version. ` +
        `Underlying error: ${(error as Error).message}`,
    );
  }

  // A dd-trace old enough to resolve but too old to export the whole facade is
  // the dangerous case: the layer pins a version, but npm users and mixed-layer
  // setups can drift. Fail loudly at load rather than mid-invocation.
  const missing = REQUIRED_METHODS.filter((method) => typeof (resolved as any)?.[method] !== "function");
  if (missing.length > 0) {
    throw new Error(
      `datadog-lambda-js loaded "${FACADE_MODULE}" but it is missing: ${missing.join(", ")}. ` +
        `Upgrade dd-trace to ${REQUIRED_DD_TRACE}.`,
    );
  }

  facade = resolved;
  return facade;
}

/** Test seam: drops the memoized facade. */
export function resetLambdaFacade(): void {
  facade = undefined;
}
