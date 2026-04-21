/**
 * @gv/config — runtime environment schema + helpers for GodsView v2.
 *
 * The zod schemas enforce that every deployed service reads the same
 * shape of env from .env / AWS SSM / Secrets Manager. If a required
 * key is missing, services MUST refuse to boot.
 */
import { z } from "zod";

export const AppEnvSchema = z.enum(["local", "dev", "staging", "prod"]);
export type AppEnv = z.infer<typeof AppEnvSchema>;

const booleanish = z
  .union([z.boolean(), z.literal("0"), z.literal("1"), z.literal("true"), z.literal("false")])
  .transform((v) => v === true || v === 1 || v === "1" || v === "true");

export const ControlPlaneEnvSchema = z.object({
  GODSVIEW_ENV: AppEnvSchema.default("local"),
  GODSVIEW_SERVICE_NAME: z.string().default("control_plane"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default("redis://localhost:6379/0"),
  JWT_SIGNING_KEY: z.string().min(32),
  JWT_ALGORITHM: z.enum(["HS256", "RS256"]).default("HS256"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),
  KILL_SWITCH_ON_BOOT: booleanish.default(false),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ControlPlaneEnv = z.infer<typeof ControlPlaneEnvSchema>;

export const WebEnvSchema = z.object({
  NEXT_PUBLIC_GODSVIEW_API_BASE: z.string().url().default("http://localhost:8000"),
  NEXT_PUBLIC_GODSVIEW_SSE_BASE: z.string().url().default("http://localhost:8000"),
  NEXT_PUBLIC_GODSVIEW_ENV: AppEnvSchema.default("local"),
});
export type WebEnv = z.infer<typeof WebEnvSchema>;

/** Parse process.env and throw with a helpful message if any key is invalid. */
export function parseControlPlaneEnv(env: NodeJS.ProcessEnv = process.env): ControlPlaneEnv {
  const result = ControlPlaneEnvSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid control_plane env:\n${lines}`);
  }
  return result.data;
}

export function parseWebEnv(env: NodeJS.ProcessEnv = process.env): WebEnv {
  const result = WebEnvSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid web env:\n${lines}`);
  }
  return result.data;
}

export const DEFAULT_PORTS = {
  web: 3000,
  control_plane: 8000,
  ingestion: 8010,
  orderflow: 8020,
  backtest_runner: 8030,
  calibration: 8040,
  promotion: 8050,
  intelligence: 8060,
  execution: 8070,
  screenshot_renderer: 8080,
  replay: 8090,
} as const;
