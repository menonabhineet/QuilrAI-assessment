export interface CompletionRequest {
  prompt: string;
  max_tokens?: number;
  temperature?: number;
  model?: string;
}

export interface CompletionResponse {
  id: string;
  model: string;
  provider: "primary" | "secondary";
  content: string;
  tokens_used: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  fallback_occurred: boolean;
  fallback_reason?: string;
  latency_ms: number;
}

export interface SanitizedGatewayError {
  error: {
    code: string;
    message: string;
    request_id?: string;
    primary_failure?: string;
    secondary_failure?: string;
  };
}

export interface RateLimitStatus {
  allowed: boolean;
  currentUsage: number;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

export interface RateLimiterOptions {
  limitTokensPerWindow?: number; // default: 50,000 tokens
  windowMs?: number;            // default: 60,000ms (1 minute)
}

export interface RouterOptions {
  primaryUrl: string;
  secondaryUrl: string;
  timeoutMs?: number; // default: 3000ms
}
