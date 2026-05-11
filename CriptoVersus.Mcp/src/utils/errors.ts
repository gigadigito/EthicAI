import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(message, 500);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized.") {
    super(message, 401);
  }
}

export class HttpError extends AppError {
  constructor(statusCode: number, message: string) {
    super(message, statusCode);
  }
}

export class EndpointUnavailableError extends AppError {
  constructor(message: string) {
    super(message, 404);
  }
}

export class UpstreamServiceError extends AppError {
  constructor(message: string) {
    super(message, 502);
  }
}

export function getPublicErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }

  return "Unexpected server error.";
}

export function getStatusCode(error: unknown): number {
  if (error instanceof AppError) {
    return error.statusCode;
  }

  return 500;
}

export function formatToolErrorResult(error: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: getPublicErrorMessage(error)
      }
    ],
    isError: true
  };
}

export function toToolJsonResult(payload: Record<string, unknown>): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}
