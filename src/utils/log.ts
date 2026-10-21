import { serializeError } from "serialize-error";

export enum LogLevel {
  DEBUG = 0,
  ERROR,
  WARNING,
  NONE,
}

export interface Logger {
  debug(message: string): void;
  error(message: string): void;
  warn(message: string): void;
}

let logger: Logger = console;
let logLevel = LogLevel.ERROR;

export function setLogger(customLogger: Logger) {
  logger = customLogger;
}

export function setLogLevel(level: LogLevel) {
  logLevel = level;
}

export function getLogLevel(): LogLevel {
  return logLevel;
}

export function logDebug(message: string, metadata?: Error | object, error?: Error) {
  if (logLevel > LogLevel.DEBUG) {
    return;
  }
  emitLog(logger.debug, "debug", message, metadata, error);
}

export function logError(message: string, metadata?: Error | object, error?: Error) {
  if (logLevel > LogLevel.ERROR) {
    return;
  }
  emitLog(logger.error, "error", message, metadata, error);
}

export function logWarning(message: string, metadata?: Error | object, error?: Error) {
  if (logLevel > LogLevel.WARNING) {
    return;
  }
  emitLog(logger.warn, "warning", message, metadata, error);
}

function emitLog(
  outputter: (a: string) => any,
  status: string,
  message: string,
  metadata?: object | Error,
  error?: Error,
) {
  message = `datadog:${message}`;
  let output: Record<string, unknown> = { status, message };
  if (metadata instanceof Error && error === undefined) {
    // allow for log*(message), log*("message", metadata), log*("message", error), and log*("message", metadata, error)
    error = metadata;
    metadata = undefined;
  }
  if (metadata !== undefined) {
    output = { ...output, ...metadata };
  }
  if (error !== undefined) {
    // Nested, not spread: spreading let the error's `message` replace ours.
    output = { ...output, error: serializeError(error) };
  }
  // An Error inside metadata (`{ error }`) would otherwise stringify as `{}`,
  // since its message and stack are not enumerable.
  outputter(JSON.stringify(output, (_key, value) => (value instanceof Error ? serializeError(value) : value)));
}
