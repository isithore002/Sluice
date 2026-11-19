// Copies deployment addresses and measurement results into public/data/manifest.json for the static dashboard.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const deployments = process.env.DEPLOYMENTS_DIR ?? resolve(root, "deployments");
const results = process.env.RESULTS_DIR ?? resolve(root, "results");
const outDir = resolve(here, "..", "public", "data");
mkdirSync(outDir, { recursive: true });

const addresses = {};
if (existsSync(deployments)) {
  for (const f of readdirSync(deployments).filter((f) => f.endsWith(".json"))) {
    Object.assign(addresses, JSON.parse(readFileSync(resolve(deployments, f), "utf8")));
  }
}

const required = ["morpho", "mockUSD", "marketId", "sluiceReactive", "sluiceVault", "relayerReserve", "siblingVault"];
const deployed = required.every((k) => addresses[k]);

const summaryFile = resolve(results, "summary.json");
const summary = existsSync(summaryFile) ? JSON.parse(readFileSync(summaryFile, "utf8")) : null;

// Unichain's MockUSD shares the key name with Base's; keep both explicitly.
const uniToken = resolve(deployments, "unichain-token.json");
if (existsSync(uniToken)) addresses.uniMockUSD = JSON.parse(readFileSync(uniToken, "utf8")).mockUSD;
const baseMarket = resolve(deployments, "base-market.json");
if (existsSync(baseMarket)) addresses.mockUSD = JSON.parse(readFileSync(baseMarket, "utf8")).mockUSD;

const manifest = { generatedAt: new Date().toISOString(), deployed, addresses, summary };
writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`dashboard data: deployed=${deployed}, summary=${summary ? "yes" : "no"}`);
