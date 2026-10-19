import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly details?: Record<string, string>;
  readonly retryAfterSeconds?: number;

  constructor(
    status: ContentfulStatusCode,
    code: string,
    message: string,
    options: { details?: Record<string, string>; retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function errorPayload(error: AppError, correlationId: string) {
  return {
    code: error.code,
    message: error.message,
    correlation_id: correlationId,
    ...(error.details ? { details: error.details } : {}),
  };
}

export function installErrorHandler(app: {
  onError: (
    handler: (error: Error, c: Context<{ Variables: { correlationId: string } }>) => Response | Promise<Response>,
  ) => void;
}) {
  app.onError((error, c) => {
    const correlationId = c.get("correlationId") ?? "unknown";
    if (error instanceof AppError) {
      if (error.retryAfterSeconds !== undefined) {
        c.header("Retry-After", String(error.retryAfterSeconds));
      }
      return c.json(errorPayload(error, correlationId), error.status);
    }
    console.error(
      JSON.stringify({
        level: "error",
        event: "unhandled_error",
        correlation_id: correlationId,
        error_name: error.name,
        message: error.message,
      }),
    );
    return c.json(
      {
        code: "INTERNAL_ERROR",
        message: "The update service failed to process the request.",
        correlation_id: correlationId,
      },
      500,
    );
  });
}
