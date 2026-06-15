import { z } from "zod";

export const credentialsSchema = z.object({
  // trim + lowercase BEFORE .email() so surrounding whitespace doesn't fail
  // validation, and storage/lookup are always normalized.
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
});

export type Credentials = z.infer<typeof credentialsSchema>;
