/**
 * Lightweight structured logger.
 * Outputs JSON lines so logs are easy to parse in production.
 */

type LogLevel = "info" | "warn" | "error" | "debug";

function formatMessage(level: LogLevel, context: string, message: string, meta?: Record<string, unknown>): string {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        context,
        message,
        ...(meta ? { meta } : {}),
    };
    return JSON.stringify(entry);
}

/**
 * Create a logger scoped to a specific context (e.g. service name, route).
 *
 * @example
 * const log = createLogger("worker");
 * log.info("Processing file", { fileId: "abc" });
 */
export function createLogger(context: string) {
    return {
        info: (message: string, meta?: Record<string, unknown>) => {
            console.log(formatMessage("info", context, message, meta));
        },

        warn: (message: string, meta?: Record<string, unknown>) => {
            console.warn(formatMessage("warn", context, message, meta));
        },

        error: (message: string, meta?: Record<string, unknown>) => {
            console.error(formatMessage("error", context, message, meta));
        },

        debug: (message: string, meta?: Record<string, unknown>) => {
            if (process.env.NODE_ENV !== "production") {
                console.debug(formatMessage("debug", context, message, meta));
            }
        },
    };
}
