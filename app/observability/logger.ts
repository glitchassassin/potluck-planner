import { AsyncLocalStorage } from "node:async_hooks";
import { Logger as RemixLogger } from "remix/middleware/logger";
import type { Middleware } from "remix/router";

export const levels = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  silent: 100,
};
export type Level = Exclude<keyof typeof levels, "silent">;
export type Detail = "off" | "summary" | "detailed";

export interface LogConfig {
  level: keyof typeof levels;
  requestDetail: Detail;
  serverTiming: Detail;
}

export function readLogConfig(env: NodeJS.ProcessEnv = process.env): LogConfig {
  function choice<T extends string>(key: string, fallback: T, values: readonly T[]): T {
    const value = env[key] ?? fallback;
    if (!values.includes(value as T)) throw new Error(`Invalid ${key}`);
    return value as T;
  }
  return {
    level: choice("LOG_LEVEL", "info", Object.keys(levels) as (keyof typeof levels)[]),
    requestDetail: choice("REQUEST_LOG_DETAIL", "summary", ["off", "summary", "detailed"]),
    serverTiming: choice("SERVER_TIMING", "off", ["off", "summary", "detailed"]),
  };
}

export interface RequestLogContext {
  requestId: string;
  started: number;
  handlerMs?: number;
  operations: Record<string, number>;
  config: LogConfig;
}
export const requestContext = new AsyncLocalStorage<RequestLogContext>();

const phoneInText = /(?<!\d)(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]?\d{4}(?!\d)/g;

/** Mask US phone numbers in string values; leave other values unchanged. */
export function sanitize(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(phoneInText, (phone) => `***${phone.replace(/\D/g, "").slice(-2)}`);
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitize(entry)]));
  }
  return value;
}

/** Compatible with Remix's message callback, with optional structured fields and severity. */
export interface LoggerFunction {
  (message: string, fields?: Record<string, unknown>, level?: Level): void;
}

// Reuse Remix's context key so context.get(Logger) works through either import.
export const Logger = RemixLogger as { defaultValue?: LoggerFunction };

export interface LoggerOptions {
  log?: LoggerFunction;
}

/** Installs context.logger; HTTP completion logs are handled by the Node adapter. */
export function logger(options: LoggerOptions = {}): Middleware<{
  key: typeof Logger;
  value: LoggerFunction;
  property: "logger";
}> {
  const log = options.log ?? createLogger(readLogConfig());
  return async (context, next) => {
    context.set(Logger, log, { property: "logger" });
    return next();
  };
}

export function createLogger(
  config: LogConfig,
  log: (line: string) => void = (line) => process.stdout.write(line + "\n"),
): LoggerFunction {
  return (message, fields = {}, level = "info") => {
    if (levels[level] < levels[config.level]) return;
    const context = requestContext.getStore();
    const { pathname, query, ...fieldsToMask } = fields;
    log(
      JSON.stringify({
        ...(sanitize(fieldsToMask) as Record<string, unknown>),
        pathname,
        query,
        timestamp: new Date().toISOString(),
        level,
        event: sanitize(message),
        ...(context ? { requestId: context.requestId } : {}),
      }),
    );
  };
}

// Names must be static operation labels, never user input or SQL statements.
export async function measure<T>(name: string, operation: () => T | Promise<T>): Promise<T> {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(name)) throw new Error("Invalid timing name");
  const context = requestContext.getStore();
  if (
    !context ||
    (context.config.requestDetail !== "detailed" && context.config.serverTiming !== "detailed")
  )
    return await operation();
  const start = performance.now();
  try {
    return await operation();
  } finally {
    context.operations[name] = (context.operations[name] ?? 0) + performance.now() - start;
  }
}
