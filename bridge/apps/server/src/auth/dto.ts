import { z } from "zod";

export const StartQrSchema = z.object({
  region: z.string().optional().default("us"),
});

export const PasswordLoginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
  countryCode: z.string().optional().default("49"),
  region: z.string().optional().default("us"),
});

export const PollQrSchema = z.object({
  token: z.string().optional(),
});
