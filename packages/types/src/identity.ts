import { z } from "zod";

export const RoleSchema = z.enum(["viewer", "analyst", "operator", "admin"]);
export type Role = z.infer<typeof RoleSchema>;

export const UserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().min(1),
  roles: z.array(RoleSchema).min(1),
  mfaEnabled: z.boolean().default(false),
  createdAt: z.string().datetime(),
  lastLoginAt: z.string().datetime().nullable(),
});
export type User = z.infer<typeof UserSchema>;

export const TokenPairSchema = z.object({
  accessToken: z.string().min(20),
  refreshToken: z.string().min(20),
  accessExpiresAt: z.string().datetime(),
  refreshExpiresAt: z.string().datetime(),
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  mfaCode: z.string().optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
