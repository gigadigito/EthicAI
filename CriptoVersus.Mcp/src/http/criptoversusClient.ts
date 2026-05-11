import type { AppConfig } from "../config.js";
import {
  EndpointUnavailableError,
  HttpError,
  UpstreamServiceError
} from "../utils/errors.js";

type RequestOptions = {
  unavailableMessage?: string;
  headers?: Record<string, string>;
};

export class CriptoVersusClient {
  constructor(private readonly config: AppConfig) {}

  async getJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(path, `${this.config.apiBaseUrl}/`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          ...options.headers
        },
        signal: controller.signal
      });

      if (!response.ok) {
        if (
          options.unavailableMessage &&
          (response.status === 404 || response.status === 405 || response.status === 501)
        ) {
          throw new EndpointUnavailableError(options.unavailableMessage);
        }

        const message = await safeReadErrorMessage(response);
        throw new HttpError(response.status, message);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof EndpointUnavailableError || error instanceof HttpError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new UpstreamServiceError("CriptoVersus API request timed out.");
      }

      throw new UpstreamServiceError("Unable to reach the CriptoVersus API.");
    } finally {
      clearTimeout(timeout);
    }
  }

  toPublicUrl(value: string | null | undefined): string {
    if (!value) {
      return "";
    }

    try {
      return new URL(value, this.config.publicOrigin).toString();
    } catch {
      return value;
    }
  }
}

async function safeReadErrorMessage(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as Record<string, unknown>;
      const message =
        typeof payload.message === "string"
          ? payload.message
          : typeof payload.error === "string"
            ? payload.error
            : undefined;

      if (message) {
        return message;
      }
    }

    const text = await response.text();
    return text.trim() || `CriptoVersus API returned HTTP ${response.status}.`;
  } catch {
    return `CriptoVersus API returned HTTP ${response.status}.`;
  }
}
