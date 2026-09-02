export interface RedactionMetrics {
  chunksProcessed: number;
  totalBytesIn: number;
  totalBytesOut: number;
  emailsRedacted: number;
  ssnsRedacted: number;
  creditCardsRedacted: number;
}

export interface StreamChunkPayload {
  id: string;
  delta: string;
  isLast?: boolean;
}

export interface GatewayStreamOptions {
  port: number;
  upstreamUrl: string;
  maxLookbackChars?: number;
}
