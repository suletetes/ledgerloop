/**
 * PII-free logger (Task 15.4).
 *
 * A simple logger that strips PII (email addresses and other personal data)
 * from log messages before writing. Ensures operational logs never contain
 * member email addresses or other PII.
 *
 * Requirements:
 * - 21.3: Exclude email and other PII from operational logs
 * - 21.4: Exclude PII from cross-member messages
 */

// ─── PII Stripping ──────────────────────────────────────────────────────────

/**
 * Regex to match email addresses in text.
 * Matches common email patterns: local@domain.tld
 */
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/** The replacement string used when an email is found. */
export const PII_REDACTED = "[REDACTED]";

/**
 * 
 * Strip PII (email addresses) from a string.
 * Replaces any email address pattern with [REDACTED].
 *
 * This function is exported so it can be used by the api-response module
 * and tested directly in property tests.
 */
export function stripPii(text: string): string {
  return text.replace(EMAIL_REGEX, PII_REDACTED);
}

/**
 * Strip PII from all string values in an object (shallow).
 * Non-string values are left unchanged.
 */
export function stripPiiFromObject(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = stripPii(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ─── Logger ──────────────────────────────────────────────────────────────────

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

/** Collected log entries (for testing). */
const logEntries: LogEntry[] = [];

/**
 * Whether to also write to console (disabled in tests by default).
 */
let consoleOutput = true;

/**
 * Log a message at the given level, stripping PII before recording.
 */
export function log(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): LogEntry {
  const safeMessage = stripPii(message);
  const safeContext = context ? stripPiiFromObject(context) : undefined;

  const entry: LogEntry = {
    level,
    message: safeMessage,
    timestamp: new Date().toISOString(),
    ...(safeContext && { context: safeContext }),
  };

  logEntries.push(entry);

  if (consoleOutput) {
    const contextStr = safeContext
      ? ` ${JSON.stringify(safeContext)}`
      : "";
    // eslint-disable-next-line no-console
    console[level === "debug" ? "log" : level](
      `[${entry.timestamp}] ${level.toUpperCase()}: ${safeMessage}${contextStr}`,
    );
  }

  return entry;
}

/** Convenience methods */
export const logger = {
  info: (message: string, context?: Record<string, unknown>) =>
    log("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) =>
    log("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) =>
    log("error", message, context),
  debug: (message: string, context?: Record<string, unknown>) =>
    log("debug", message, context),
};

// ─── Test Utilities ──────────────────────────────────────────────────────────

/** Get all recorded log entries (for testing). */
export function getLogEntries(): readonly LogEntry[] {
  return logEntries;
}

/** Clear all recorded log entries (for testing). */
export function clearLogEntries(): void {
  logEntries.length = 0;
}

/** Enable or disable console output (for testing). */
export function setConsoleOutput(enabled: boolean): void {
  consoleOutput = enabled;
}
