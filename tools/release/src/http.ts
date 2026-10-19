export interface ApiClientOptions {
  baseUrl: string;
  adminToken?: string;
  timeoutMs?: number;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId: string | undefined;
  readonly details: Record<string, string> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    correlationId?: string,
    details?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
    this.details = details;
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly adminToken: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.adminToken = options.adminToken;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      admin?: boolean;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
      ...options.headers,
    };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.admin) {
      if (!this.adminToken) {
        throw new Error(
          "ORDERHUB_UPDATER_ADMIN_TOKEN is required for release administration commands",
        );
      }
      headers.authorization = `Bearer ${this.adminToken}`;
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text.slice(0, 500) };
      }
    }
    if (!response.ok) {
      const record =
        payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      throw new ApiClientError(
        response.status,
        typeof record.code === "string" ? record.code : `HTTP_${response.status}`,
        typeof record.message === "string" ? record.message : response.statusText,
        typeof record.correlation_id === "string" ? record.correlation_id : undefined,
        record.details && typeof record.details === "object"
          ? (record.details as Record<string, string>)
          : undefined,
      );
    }
    return payload as T;
  }
}
