import { z } from "zod";

export const CreateCameraSchema = z.object({
  name: z.string().min(1),
  did: z.string().min(1),
  localKey: z.string().optional().default(""),
  ip: z.string().optional().default(""),
  port: z.number().optional().default(6668),
  p2pId: z.string().optional().default(""),
  category: z.string().optional().default("sp"),
  productId: z.string().optional().default(""),
  uuid: z.string().optional().default(""),
  quality: z.enum(["hd", "sd"]).optional().default("hd"),
  audioEnabled: z.boolean().optional().default(true),
  transcodeH264: z.boolean().optional().default(false),
  rtspPort: z.number().optional(),
});

export type CreateCameraDto = z.infer<typeof CreateCameraSchema>;
