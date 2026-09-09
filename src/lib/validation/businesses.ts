import { z } from "zod";

export const createBusinessSchema = z.object({
  name: z.string().trim().min(1).max(200),
});
