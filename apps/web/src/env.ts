import { z } from 'zod';

const envSchema = z.object({
  MODE: z.enum(['development', 'production']),
  VITE_API_URL: z.string().url().default('http://localhost:3001'),
  VITE_APP_NAME: z.string().default('FluidMind'),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse({
  MODE: import.meta.env.MODE,
  VITE_API_URL: import.meta.env.VITE_API_URL,
  VITE_APP_NAME: import.meta.env.VITE_APP_NAME,
});

if (!parsed.success) {
  console.error('Invalid environment variables', parsed.error.flatten());
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
