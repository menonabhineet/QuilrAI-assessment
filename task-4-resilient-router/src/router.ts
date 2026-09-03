import {
  CompletionRequest,
  CompletionResponse,
  RouterOptions,
  SanitizedGatewayError,
} from "./types.js";

export class ResilientModelRouter {
  private primaryUrl: string;
  private secondaryUrl: string;
  private timeoutMs: number;

  constructor(options: RouterOptions) {
    this.primaryUrl = options.primaryUrl;
    this.secondaryUrl = options.secondaryUrl;
    this.timeoutMs = options.timeoutMs ?? 3000;
  }

  private async callProvider(
    url: string,
    payload: CompletionRequest,
    timeout: number,
    clientSignal?: AbortSignal
  ): Promise<{ status: number; data: any; durationMs: number }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const start = Date.now();

    if (clientSignal) {
      if (clientSignal.aborted) {
        controller.abort();
      } else {
        clientSignal.addEventListener("abort", () => controller.abort());
      }
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const rawText = await response.text();
      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { raw: rawText };
      }

      return {
        status: response.status,
        data,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      if (err.name === "AbortError") {
        return {
          status: 504,
          data: { error: `Gateway timeout after ${timeout}ms` },
          durationMs: Date.now() - start,
        };
      }
      return {
        status: 502,
        data: { error: "Network or socket connection error" },
        durationMs: Date.now() - start,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Routes completion request to primary provider with a 3000ms timeout race.
   * If primary returns 429 or times out, automatically falls back to secondary provider.
   * If both fail, returns a sanitized gateway error payload.
   */
  async routeCompletion(request: CompletionRequest, clientSignal?: AbortSignal): Promise<CompletionResponse> {
    const startOverall = Date.now();

    // 1. Attempt Primary Provider with 3000ms deadline
    const primaryRes = await this.callProvider(this.primaryUrl, request, this.timeoutMs, clientSignal);

    if (primaryRes.status === 200 && primaryRes.data) {
      return {
        id: primaryRes.data.id || `comp-prim-${Date.now()}`,
        model: primaryRes.data.model || "primary-model",
        provider: "primary",
        content: primaryRes.data.content,
        tokens_used: primaryRes.data.tokens_used || {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
        fallback_occurred: false,
        latency_ms: primaryRes.durationMs,
      };
    }

    // Determine fallback reason
    let fallbackReason = "primary_unknown_failure";
    if (primaryRes.status === 429) {
      fallbackReason = "primary_rate_limited_429";
    } else if (primaryRes.status === 504) {
      fallbackReason = `primary_timeout_${this.timeoutMs}ms`;
    } else if (primaryRes.status >= 500) {
      fallbackReason = "primary_server_error";
    }

    // 2. Trigger Failover to Secondary Provider
    const secondaryRes = await this.callProvider(this.secondaryUrl, request, 5000, clientSignal);

    if (secondaryRes.status === 200 && secondaryRes.data) {
      return {
        id: secondaryRes.data.id || `comp-sec-${Date.now()}`,
        model: secondaryRes.data.model || "secondary-model",
        provider: "secondary",
        content: secondaryRes.data.content,
        tokens_used: secondaryRes.data.tokens_used || {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
        fallback_occurred: true,
        fallback_reason: fallbackReason,
        latency_ms: Date.now() - startOverall,
      };
    }

    // 3. Both Providers Failed: Produce Sanitized Gateway Error
    const secondaryReason =
      secondaryRes.status === 429
        ? "secondary_rate_limited_429"
        : secondaryRes.status === 504
        ? "secondary_timeout"
        : "secondary_upstream_error";

    const sanitizedError: SanitizedGatewayError = {
      error: {
        code: "ALL_UPSTREAM_PROVIDERS_FAILED",
        message: "Unable to complete request: primary provider failed and secondary fallback was unreachable.",
        primary_failure: fallbackReason,
        secondary_failure: secondaryReason,
      },
    };

    const error = new Error(sanitizedError.error.message);
    (error as any).gatewayPayload = sanitizedError;
    (error as any).status = 502;
    throw error;
  }
}
