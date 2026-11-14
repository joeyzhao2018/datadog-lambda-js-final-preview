import { Config, TraceHeaders, datadog, getTraceHeaders } from "datadog-lambda-js";
import { LambdaConfig } from "datadog-lambda-js/dist/facade";
import { SampleMode, TraceContext, TraceExtractor, TraceSource } from "./current-shim-contract";

declare const existingExtractor: TraceExtractor;
const config: Config = { traceExtractor: existingExtractor };
const facadeConfig: Partial<LambdaConfig> = { traceExtractor: existingExtractor };
datadog(async () => "result", config);

const current: TraceContext = {
  traceId: "1234",
  parentId: "5678",
  sampleMode: SampleMode.USER_KEEP,
  source: TraceSource.Event,
};
const legacy: TraceContext = {
  traceID: "1234",
  parentID: "5678",
  sampleMode: SampleMode.AUTO_REJECT,
  source: TraceSource.Xray,
};
const noParent: TraceContext = { sampleMode: SampleMode.AUTO_KEEP, source: TraceSource.DdTrace };

for (const value of [current, legacy, noParent]) {
  const sync: NonNullable<Config["traceExtractor"]> = (_event, context) => {
    const requestId: string = context.awsRequestId;
    return value;
  };
  const asyncExtractor: NonNullable<Config["traceExtractor"]> = async () => value;
  const forwarded: Partial<LambdaConfig> = { traceExtractor: asyncExtractor };
  datadog(async () => "result", { traceExtractor: sync });
  datadog(async () => "result", forwarded);
}

const headers: TraceHeaders = {
  "x-datadog-trace-id": "1234",
  "x-datadog-parent-id": "5678",
  "x-datadog-sampling-priority": "2",
};
const outgoing: Partial<TraceHeaders> = getTraceHeaders();
// Headers are outgoing propagation data, not the custom extractor result.
// @ts-expect-error Missing sampleMode and source.
const headerExtractor: NonNullable<Config["traceExtractor"]> = () => headers;
// @ts-expect-error The facade must reject the same incorrect return type.
const facadeHeaderExtractor: LambdaConfig["traceExtractor"] = async () => headers;
// @ts-expect-error Sampling is numeric in the current shim contract.
const stringSampling: NonNullable<Config["traceExtractor"]> = () => ({ ...current, sampleMode: "2" });
// @ts-expect-error Source must be an existing shim trace source.
const unknownSource: NonNullable<Config["traceExtractor"]> = () => ({ ...current, source: "custom" });
