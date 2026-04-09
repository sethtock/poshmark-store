import { config } from 'dotenv';
import { readFile } from 'fs/promises';

export function loadEnv() {
  // Try to load .env from project root
  config({ path: new URL('../../../.env', import.meta.url).pathname });
  // Also check current working directory
  config();
}

export async function requireEnv(key: string): Promise<string> {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}
