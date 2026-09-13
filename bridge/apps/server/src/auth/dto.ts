import { z } from "zod";

export const StartQrSchema = z.object({
  region: z.string().optional().default("us"),
});

export const PollQrSchema = z.object({
  token: z.string().optional(),
});
