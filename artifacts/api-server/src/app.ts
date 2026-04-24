import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { runtimeConfig } from "./lib/runtime_config";
import { createRateLimiter, securityHeadersMiddleware } from "./lib/request_guards";
import {
  httpRequestsTotal,
  httpRequestDuration,
  httpRequestsInFlight,
} from "./lib/metrics";

// ── ESM __dirname shim (compatible with both tsx source-run and esbuild dist) ─
const __dirname: string =
  typeof globalThis.__dirname === "string"
    ? globalThis.__dirname
    : path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();
const allowedCorsOrigins = runtimeConfig.corsOrigins;

app.set("trust proxy", runtimeConfig.trustProxy);

app.use(
  pinoHttp({
    logger,
    genReqId(req, res) {
      const incoming = req.headers["x-request-id"];
      const requestId =
        typeof incoming === "string" && incoming.trim().length > 0
          ? incoming.trim()
          : randomUUID();
      res.setHeader("x-request-id", requestId);
      return requestId;
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.disable("x-powered-by");
app.use((req, res, next) => {
  if (runtimeConfig.nodeEnv === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});
app.use(securityHeadersMiddleware);

// ── HTTP metrics instrumentation ──────────────────────────────────────
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  httpRequestsInFlight.inc();
  res.on("finish", () => {
    httpRequestsInFlight.dec();
    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
    const normalizedPath = (req.route?.path ?? req.path)
      .replace(/\/[0-9a-f]{8,}/gi, "/:id")
      .replace(/\/\d+/g, "/:id")
      .replace(/\?.*/g, "");
    httpRequestsTotal.inc({ method: req.method, path: normalizedPath, status: String(res.statusCode) });
    httpRequestDuration.observe(durationSec);
  });
  next();
});
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedCorsOrigins.length === 0) {
        callback(null, false);
        return;
      }
      callback(null, allowedCorsOrigins.includes(origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);
app.use(express.json({ limit: runtimeConfig.requestBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: runtimeConfig.requestBodyLimit }));

app.use("/api", createRateLimiter({ windowMs: runtimeConfig.rateLimitWindowMs, max: runtimeConfig.rateLimitMax }));
app.use("/api", router);
// Also mount non-prefixed routes (backtest, health)
app.use(router);

// ── Static file serving for single-process / Docker deployment ──────────────
const publicDir = path.resolve(__dirname, "../public");
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  // SPA fallback — serve index.html for non-API routes
  // Express 5 requires a named wildcard: use /{*path} instead of bare *
  app.get("/{*path}", (_req: Request, res: Response) => {
    const indexPath = path.join(publicDir, "index.html");
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).json({ error: "not_found", message: "The requested endpoint does not exist." });
    }
  });
} else {
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: "not_found",
      message: "The requested endpoint does not exist.",
    });
  });
}

// Detect database connection errors for graceful 503 responses
function isDbConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  const dbPatterns = [
    "connection refused", "econnrefused", "connection terminated",
    "connection reset", "no pg_hba.conf", "could not connect",
    "database", "relation", "does not exist", "pool",
    "timeout expired", "too many clients", "connection is closed",
  ];
  return dbPatterns.some((p) => msg.includes(p));
}

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Detect DB connection errors and return 503 Service Unavailable
  const isDbError = isDbConnectionError(err);
  const status = isDbError
    ? 503
    : Number.isFinite((err as { status?: number }).status)
      ? Math.max(400, Math.min(599, Number((err as { status?: number }).status)))
      : 500;

  logger.error(
    {
      err,
      requestId: req.id,
      method: req.method,
      path: req.originalUrl ?? req.url,
      isDbError,
    },
    isDbError ? "Database unavailable — returning 503" : "Unhandled API error",
  );

  if (res.headersSent) {
    return;
  }

  if (isDbError) {
    res.status(503).json({
      error: "service_unavailable",
      message: "Database temporarily unavailable. The system continues operating with reduced capabilities.",
      source: "unavailable",
      request_id: req.id,
    });
    return;
  }

  const isServerError = status >= 500;
  res.status(status).json({
    error: isServerError ? "internal_error" : "request_error",
    message: isServerError && runtimeConfig.nodeEnv === "production"
      ? "Internal server error."
      : err instanceof Error
        ? err.message
        : "Unhandled request error.",
    request_id: req.id,
  });
};

app.use(errorHandler);

export default app;
