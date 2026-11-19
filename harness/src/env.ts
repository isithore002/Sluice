import { config } from "dotenv";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Repository root (harness/ lives one level below it). */
export const ROOT = resolve(here, "..", "..");

/** ENV_FILE lets a rehearsal point at local forks without touching .env. */
const envFile = process.env.ENV_FILE ?? resolve(ROOT, ".env");
if (!existsSync(envFile)) {
  throw new Error(`Missing ${envFile}: copy .env.example to .env and set PRIVATE_KEY`);
}
config({ path: envFile });

/** Where the forge scripts wrote addresses (override for rehearsals). */
export const DEPLOYMENTS = process.env.DEPLOYMENTS_DIR ?? resolve(ROOT, "deployments");

/** Where measurement results go. */
export const RESULTS = process.env.RESULTS_DIR ?? resolve(ROOT, "results");
mkdirSync(RESULTS, { recursive: true });

export function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in ${envFile}`);
  return v;
}

/** Parse `--name value` CLI flags. */
export function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
