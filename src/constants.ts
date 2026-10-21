// Replaced at publish time by scripts/update_dist_version.sh. The value is
// reported to dd-trace as the `datadog_lambda` span tag and the
// `datadog_lambda:vX.Y.Z` metric tag, which is how a trace is traced back to a
// layer version — so this stays shim-owned even though dd-trace emits it.
export const datadogLambdaVersion = "X.X.X";

// Response-streaming handler markers. Duplicated in dd-trace (it must recognise
// a streaming handler to preserve the marker through wrapping); both sides read
// the same well-known symbol from the process-global registry, so they agree by
// construction rather than by convention.
export const HANDLER_STREAMING = Symbol.for("aws.lambda.runtime.handler.streaming");
export const STREAM_RESPONSE = "response";
