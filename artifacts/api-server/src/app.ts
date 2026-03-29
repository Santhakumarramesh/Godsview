import { randomUUID } from "node:crypto";
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

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: "not_found",
    message: "The requested endpoint does not exist.",
  });
});

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = Number.isFinite((err as { status?: number }).status)
    ? Math.max(400, Math.min(599, Number((err as { status?: number }).status)))
    : 500;

  logger.error(
    {
      err,
      requestId: req.id,
      method: req.method,
      path: req.originalUrl ?? req.url,
    },
    "Unhandled API error",
  );

  if (res.headersSent) {
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
