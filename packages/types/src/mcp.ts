import { z } from "zod";

export const McpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  transport: z.string(),
  endpointUrl: z.string().nullable(),
  command: z.string().nullable(),
  authMode: z.string(),
  secretRef: z.string().nullable(),
  scopes: z.array(z.string()),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type McpServer = z.infer<typeof McpServerSchema>;

export const McpServerListSchema = z.object({
  servers: z.array(McpServerSchema),
  total: z.number().int().nonnegative(),
});
export type McpServerList = z.infer<typeof McpServerListSchema>;

export const CreateMcpServerRequestSchema = z.object({
  name: z.string().min(1),
  transport: z.string().min(1),
  endpointUrl: z.string().url().optional(),
  command: z.string().optional(),
  authMode: z.string().default("none"),
  secretRef: z.string().optional(),
  scopes: z.array(z.string()).default([]),
});
export type CreateMcpServerRequest = z.infer<typeof CreateMcpServerRequestSchema>;

export const UpdateMcpServerRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    endpointUrl: z.string().url().optional(),
    command: z.string().optional(),
    authMode: z.string().optional(),
    secretRef: z.string().optional(),
    scopes: z.array(z.string()).optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type UpdateMcpServerRequest = z.infer<typeof UpdateMcpServerRequestSchema>;
