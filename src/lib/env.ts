import { config } from 'dotenv';
import { readFile } from 'fs/promises';

export function loadEnv() {
  // Try to load .env from project root
  config({ path: new URL('../../../.env', import.meta.url).pathname });
  // Also check current working directory
  config();
}

export const REVIEW_PRICE_THRESHOLD = Number(process.env.REVIEW_PRICE_THRESHOLD ?? 80);
export const REVIEW_PRICE_THRESHOLD_REASON = REVIEW_PRICE_THRESHOLD === 80
  ? `Price $${REVIEW_PRICE_THRESHOLD}+ exceeds threshold`
  : `Price $${REVIEW_PRICE_THRESHOLD}+ exceeds custom threshold (REVIEW_PRICE_THRESHOLD=${REVIEW_PRICE_THRESHOLD})`;

export async function requireEnv(key: string): Promise<string> {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}
