import { z } from "zod";

export const CreateCameraSchema = z
  .object({
    name: z.string().min(1),
    did: z.string().min(1),
    localKey: z.string().optional().default(""),
    ip: z.string().optional().default(""),
    port: z.coerce.number().optional().default(6668),
    p2pId: z.string().optional().default(""),
    category: z.string().optional().default("sp"),
    productId: z.string().optional().default(""),
    uuid: z.string().optional().default(""),
    quality: z
      .string()
      .optional()
      .default("hd")
      .transform((v) => (v.toLowerCase() === "sd" ? "sd" : "hd")),
    audioEnabled: z.boolean().optional().default(true),
    rtspPort: z.coerce.number().optional(),
  })
  .passthrough();

export type CreateCameraDto = z.infer<typeof CreateCameraSchema>;
