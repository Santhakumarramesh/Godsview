import type { ErrorEnvelope } from "@gv/types";

export type FetchImpl = typeof fetch;

export interface ApiClientOptions {
  baseUrl: string;
  fetchImpl?: FetchImpl;
  getAccessToken?: () => string | null | Promise<string | null>;
  correlationIdProvider?: () => string;
  onError?: (err: ApiError) => void;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorEnvelope | null;
  readonly correlationId: string | null;
  constructor(status: number, body: ErrorEnvelope | null, correlationId: string | null) {
    super(body?.error?.message ?? `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.correlationId = correlationId;
  }
}

function randomCorrelationId(): string {
  // cor_ + 26 base32 chars ≈ ULID style, but without external dep.
  const chars = "0123456789abcdefghjkmnpqrstvwxyz";
  let out = "cor_";
  for (let i = 0; i < 26; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export class ApiClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchImpl;
  private readonly getAccessToken?: ApiClientOptions["getAccessToken"];
  private readonly correlationIdProvider: () => string;
  private readonly onError?: ApiClientOptions["onError"];

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.getAccessToken = opts.getAccessToken;
    this.correlationIdProvider = opts.correlationIdProvider ?? randomCorrelationId;
    this.onError = opts.onError;
  }

  async request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
    const correlationId = this.correlationIdProvider();
    const headers = new Headers(init?.headers);
    headers.set("accept", "application/json");
    headers.set("x-correlation-id", correlationId);
    if (body !== undefined) {
      headers.set("content-type", "application/json");
    }
    if (this.getAccessToken) {
      const token = await this.getAccessToken();
      if (token) {
        headers.set("authorization", `Bearer ${token}`);
      }
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      ...init,
    });
    if (!res.ok) {
      let envelope: ErrorEnvelope | null = null;
      try {
        envelope = (await res.json()) as ErrorEnvelope;
      } catch {
        envelope = null;
      }
      const err = new ApiError(res.status, envelope, envelope?.error?.correlation_id ?? correlationId);
      this.onError?.(err);
      throw err;
    }
    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }

  get<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>("GET", path, undefined, init);
  }
  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.request<T>("POST", path, body, init);
  }
  put<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.request<T>("PUT", path, body, init);
  }
  patch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.request<T>("PATCH", path, body, init);
  }
  delete<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>("DELETE", path, undefined, init);
  }
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  return new ApiClient(opts);
}
