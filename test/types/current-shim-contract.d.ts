// Extracted unchanged from datadog-lambda-js v12.144.0:
// bb5266a00e72eba0edcfe8d73256fe70461547c4 / src/trace/trace-context-service.ts
import { Context } from "aws-lambda";

export enum TraceSource {
  Xray = "xray",
  Event = "event",
  DdTrace = "ddtrace",
}

export enum SampleMode {
  USER_REJECT = -1,
  AUTO_REJECT = 0,
  AUTO_KEEP = 1,
  USER_KEEP = 2,
}

export interface TraceContext {
  /**
   * @deprecated use `traceId`
   */
  traceID?: string;
  /**
   * @deprecated use `parentId`
   */
  parentID?: string;
  traceId?: string;
  parentId?: string;
  sampleMode: SampleMode;
  source: TraceSource;
}

export type TraceExtractor = (event: any, context: Context) => Promise<TraceContext> | TraceContext;
