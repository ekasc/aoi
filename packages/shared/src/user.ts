import { z } from 'zod';

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().optional(),
  createdAt: z.string(),
});

export type User = z.infer<typeof userSchema>;
