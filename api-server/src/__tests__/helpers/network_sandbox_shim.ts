/**
 * network_sandbox_shim.ts
 *
 * Vitest setup helper for sandboxed environments where binding TCP sockets
 * is blocked (EPERM). It virtualizes localhost HTTP servers in-memory:
 *   - server.listen()/address()/close()
 *   - http.request()/http.get()
 *
 * This allows existing route tests to keep their current http.request usage.
 */

import { EventEmitter } from "events";
import http, {
  IncomingMessage,
  ServerResponse,
  type IncomingHttpHeaders,
  type OutgoingHttpHeaders,
  type RequestOptions,
} from "http";
import net from "net";
import { PassThrough } from "stream";

const SHIM_KEY = Symbol.for("godsview.networkSandboxShim");
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const TEST_MAX_PROCESS_LISTENERS = 50;

type ResponseCallback = (res: IncomingMessage) => void;

interface ShimState {
  installed: boolean;
}

interface RequestTarget {
  url: URL;
  options?: RequestOptions;
}

function toIncomingHeaders(headers: OutgoingHttpHeaders): IncomingHttpHeaders {
  const out: IncomingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue;
    out[key.toLowerCase()] = Array.isArray(value) ? value.map((v) => String(v)) : String(value);
  }
  return out;
}

function toBuffer(chunk: unknown, encoding?: BufferEncoding): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  return Buffer.from(String(chunk ?? ""), encoding);
}

function applyRequestOptions(url: URL, options?: RequestOptions): URL {
  if (!options) return url;

  if (typeof options.host === "string" && options.host.length > 0) {
    const [hostPart, portPart] = options.host.split(":");
    if (hostPart) url.hostname = hostPart;
    if (portPart) url.port = portPart;
  }
  if (options.hostname) url.hostname = options.hostname;
  if (options.port != null) url.port = String(options.port);
  if (options.protocol) url.protocol = options.protocol;

  if (typeof options.path === "string" && options.path.length > 0) {
    if (/^https?:\/\//i.test(options.path)) {
      const parsed = new URL(options.path);
      url.pathname = parsed.pathname;
      url.search = parsed.search;
    } else {
      const queryIdx = options.path.indexOf("?");
      if (queryIdx >= 0) {
        url.pathname = options.path.slice(0, queryIdx) || "/";
        url.search = options.path.slice(queryIdx);
      } else {
        url.pathname = options.path || "/";
        url.search = "";
      }
    }
  }
  if (!url.pathname) url.pathname = "/";

  return url;
}

function resolveRequestTarget(arg0: unknown, arg1?: unknown): RequestTarget | null {
  if (typeof arg0 === "string" || arg0 instanceof URL) {
    const base = new URL(arg0.toString(), "http://localhost/");
    const options = arg1 as RequestOptions | undefined;
    return { url: applyRequestOptions(base, options), options };
  }

  if (arg0 && typeof arg0 === "object") {
    const options = arg0 as RequestOptions;
    let url: URL;
    if (typeof options.href === "string") {
      url = new URL(options.href);
    } else {
      const protocol = options.protocol ?? "http:";
      const host = typeof options.host === "string"
        ? options.host
        : `${options.hostname ?? "localhost"}${options.port != null ? `:${options.port}` : ""}`;
      const path = options.path ?? "/";
      url = new URL(`${protocol}//${host}${path}`);
    }
    return { url: applyRequestOptions(url, options), options };
  }

  return null;
}

function normalizeRequestHeaders(headers?: OutgoingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue;
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}

function buildPath(url: URL): string {
  const path = `${url.pathname || "/"}${url.search || ""}`;
  return path || "/";
}

class InMemoryClientRequest extends EventEmitter {
  private readonly chunks: Buffer[] = [];
  private readonly headers: Record<string, string>;
  private ended = false;

  constructor(
    private readonly server: http.Server,
    private readonly method: string,
    private readonly url: URL,
    initialHeaders: OutgoingHttpHeaders | undefined,
    private readonly onResponse?: ResponseCallback,
  ) {
    super();
    this.headers = normalizeRequestHeaders(initialHeaders);
  }

  setHeader(name: string, value: string | number | readonly string[]): void {
    this.headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
  }

  getHeader(name: string): string | undefined {
    return this.headers[name.toLowerCase()];
  }

  removeHeader(name: string): void {
    delete this.headers[name.toLowerCase()];
  }

  write(
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error: Error | null | undefined) => void),
    cb?: (error: Error | null | undefined) => void,
  ): boolean {
    const enc = typeof encoding === "string" ? encoding : undefined;
    this.chunks.push(toBuffer(chunk, enc));
    if (typeof encoding === "function") encoding(null);
    if (typeof cb === "function") cb(null);
    return true;
  }

  end(
    chunk?: string | Uint8Array,
    encoding?: BufferEncoding | (() => void),
    cb?: () => void,
  ): this {
    if (this.ended) return this;
    this.ended = true;

    const enc = typeof encoding === "string" ? encoding : undefined;
    if (chunk != null) this.chunks.push(toBuffer(chunk, enc));

    const body = Buffer.concat(this.chunks);
    if (body.length > 0 && this.headers["content-length"] == null) {
      this.headers["content-length"] = String(body.length);
    }

    const socket = new net.Socket({ readable: true, writable: true });
    const req = new IncomingMessage(socket);
    req.method = this.method;
    req.url = buildPath(this.url);
    req.headers = this.headers;
    if (body.length > 0) req.push(body);
    req.push(null);

    const res = new ServerResponse(req);
    const response = new PassThrough() as PassThrough & IncomingMessage;
    (response as unknown as { statusCode: number }).statusCode = 200;
    (response as unknown as { headers: IncomingHttpHeaders }).headers = {};
    (response as unknown as { setEncoding: (encoding: BufferEncoding) => void }).setEncoding = () => {};

    let started = false;
    const emitResponse = () => {
      if (started) return;
      started = true;
      (response as unknown as { statusCode: number }).statusCode = res.statusCode ?? 200;
      (response as unknown as { headers: IncomingHttpHeaders }).headers = toIncomingHeaders(res.getHeaders());
      this.onResponse?.(response);
    };

    const origWrite = res.write.bind(res);
    res.write = ((data: unknown, writeEncoding?: BufferEncoding | ((error: Error | null | undefined) => void), writeCb?: (error: Error | null | undefined) => void) => {
      emitResponse();
      if (data != null) {
        const buf = toBuffer(data, typeof writeEncoding === "string" ? writeEncoding : undefined);
        if (buf.length > 0) response.write(buf);
      }
      return origWrite(data as any, writeEncoding as any, writeCb as any);
    }) as typeof res.write;

    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = ((statusCode: number, ...args: unknown[]) => {
      const out = origWriteHead(statusCode as any, ...(args as any));
      emitResponse();
      return out;
    }) as typeof res.writeHead;

    if (typeof res.flushHeaders === "function") {
      const origFlush = res.flushHeaders.bind(res);
      res.flushHeaders = (() => {
        const out = origFlush();
        emitResponse();
        return out;
      }) as typeof res.flushHeaders;
    }

    const origEnd = res.end.bind(res);
    res.end = ((endData?: unknown, endEncoding?: BufferEncoding | (() => void), endCb?: () => void) => {
      emitResponse();
      if (endData != null) {
        const buf = toBuffer(endData, typeof endEncoding === "string" ? endEncoding : undefined);
        if (buf.length > 0) response.write(buf);
      }

      const savedWrite = res.write;
      res.write = origWrite as typeof res.write;
      const out = origEnd(endData as any, endEncoding as any, endCb as any);
      res.write = savedWrite;

      queueMicrotask(() => response.end());
      return out;
    }) as typeof res.end;

    res.on("error", (err) => {
      this.emit("error", err);
    });

    try {
      this.server.emit("request", req, res);
    } catch (err) {
      this.emit("error", err as Error);
    }

    if (typeof encoding === "function") encoding();
    if (typeof cb === "function") cb();
    return this;
  }

  abort(): void {
    this.emit("abort");
  }

  destroy(error?: Error): this {
    if (error) this.emit("error", error);
    this.emit("close");
    return this;
  }

  setTimeout(_timeout: number, callback?: () => void): this {
    if (callback) callback();
    return this;
  }

  setNoDelay(_noDelay?: boolean): this {
    return this;
  }

  setSocketKeepAlive(_enable?: boolean, _initialDelay?: number): this {
    return this;
  }
}

function installNetworkSandboxShim(): void {
  const globalAny = globalThis as Record<string | symbol, unknown>;
  const state = globalAny[SHIM_KEY] as ShimState | undefined;
  if (state?.installed) return;

  const portRegistry = new Map<number, http.Server>();
  let nextPort = 42000;

  const originalListen = http.Server.prototype.listen;
  const originalAddress = http.Server.prototype.address;
  const originalClose = http.Server.prototype.close;
  const originalRequest = http.request.bind(http);
  const originalGet = http.get.bind(http);

  (http.Server.prototype.listen as unknown as (...args: unknown[]) => http.Server) = function patchedListen(...args: unknown[]): http.Server {
    const cb = args.find((a) => typeof a === "function") as (() => void) | undefined;
    const explicitPort = typeof args[0] === "number" ? args[0] : 0;
    const port = explicitPort > 0 ? explicitPort : nextPort++;

    (this as unknown as { __sandbox_port: number }).__sandbox_port = port;
    (this as unknown as { __sandbox_listening: boolean }).__sandbox_listening = true;
    portRegistry.set(port, this);

    queueMicrotask(() => {
      cb?.();
      this.emit("listening");
    });
    return this;
  };

  http.Server.prototype.address = function patchedAddress(): ReturnType<typeof originalAddress> {
    const isSandbox = (this as unknown as { __sandbox_listening?: boolean }).__sandbox_listening === true;
    if (!isSandbox) return originalAddress.call(this);
    const port = (this as unknown as { __sandbox_port: number }).__sandbox_port;
    return { address: "127.0.0.1", family: "IPv4", port } as ReturnType<typeof originalAddress>;
  };

  http.Server.prototype.close = function patchedClose(cb?: (err?: Error) => void): http.Server {
    const isSandbox = (this as unknown as { __sandbox_listening?: boolean }).__sandbox_listening === true;
    if (!isSandbox) return originalClose.call(this, cb as any);

    const port = (this as unknown as { __sandbox_port: number }).__sandbox_port;
    portRegistry.delete(port);
    (this as unknown as { __sandbox_listening: boolean }).__sandbox_listening = false;

    queueMicrotask(() => {
      this.emit("close");
      cb?.();
    });
    return this;
  };

  (http.request as unknown as (...args: unknown[]) => http.ClientRequest) = function patchedRequest(...rawArgs: unknown[]): http.ClientRequest {
    const cbArg = typeof rawArgs[rawArgs.length - 1] === "function"
      ? (rawArgs[rawArgs.length - 1] as ResponseCallback)
      : undefined;
    const arg0 = rawArgs[0];
    const arg1 = rawArgs[1];
    const target = resolveRequestTarget(arg0, arg1);

    if (!target) return originalRequest(...(rawArgs as Parameters<typeof originalRequest>));

    const targetPort = Number(target.url.port || "80");
    const server = portRegistry.get(targetPort);
    const method = String(target.options?.method ?? "GET").toUpperCase();

    if (
      target.url.protocol !== "http:" ||
      !LOCAL_HOSTS.has(target.url.hostname) ||
      !server
    ) {
      return originalRequest(...(rawArgs as Parameters<typeof originalRequest>));
    }

    const req = new InMemoryClientRequest(server, method, target.url, target.options?.headers, cbArg);
    return req as unknown as http.ClientRequest;
  };

  (http.get as unknown as (...args: unknown[]) => http.ClientRequest) = function patchedGet(...args: unknown[]): http.ClientRequest {
    const req = http.request(...args as Parameters<typeof http.request>);
    req.end();
    return req;
  };

  globalAny[SHIM_KEY] = { installed: true } as ShimState;

  // Keep references reachable for debugging / future restore if needed.
  globalAny[Symbol.for("godsview.networkSandboxShim.originals")] = {
    originalListen,
    originalAddress,
    originalClose,
    originalRequest,
    originalGet,
  };
}

installNetworkSandboxShim();

// Test runs import many modules that attach process-level shutdown listeners.
// Raise the limit for test workers so warning noise does not mask real failures.
if (process.getMaxListeners() < TEST_MAX_PROCESS_LISTENERS) {
  process.setMaxListeners(TEST_MAX_PROCESS_LISTENERS);
}
