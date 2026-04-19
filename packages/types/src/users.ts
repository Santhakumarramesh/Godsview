import { z } from "zod";
import { RoleSchema } from "./identity.js";

export const AdminUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().min(1),
  roles: z.array(RoleSchema),
  mfaEnabled: z.boolean(),
  disabled: z.boolean(),
  createdAt: z.string().datetime(),
  lastLoginAt: z.string().datetime().nullable(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const AdminUserListSchema = z.object({
  users: z.array(AdminUserSchema),
  total: z.number().int().nonnegative(),
});
export type AdminUserList = z.infer<typeof AdminUserListSchema>;

export const CreateUserRequestSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  password: z.string().min(12),
  roles: z.array(RoleSchema).min(1),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRequestSchema = z
  .object({
    displayName: z.string().min(1).optional(),
    roles: z.array(RoleSchema).optional(),
    mfaEnabled: z.boolean().optional(),
    disabled: z.boolean().optional(),
  })
  .strict();
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;
