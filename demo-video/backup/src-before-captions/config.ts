export const BASE_URL = "https://posit.pcluster.soleng.posit.it";
export const VIEWPORT = { width: 1920, height: 1080 };
export const SLOW_MO = 150;

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Environment variable ${name} must be set`);
  }
  return v;
}

/** Deliberate pause so the viewer can follow what is happening. */
export const beat = (ms = 1000) => new Promise<void>((r) => setTimeout(r, ms));
