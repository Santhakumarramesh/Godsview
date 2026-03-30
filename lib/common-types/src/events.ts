import { z } from "zod";

export const EventEnvelopeSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  source: z.string(),
  symbol: z.string().nullable(),
  ts: z.string(),
  correlationId: z.string(),
  version: z.string(),
  payload: z.unknown(),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

