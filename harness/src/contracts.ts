import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Abi, Address, Hex } from "viem";
import { DEPLOYMENTS, ROOT } from "./env.js";

function abi(name: string): Abi {
  const file = resolve(ROOT, "out", `${name}.sol`, `${name}.json`);
  try {
    return JSON.parse(readFileSync(file, "utf8")).abi as Abi;
  } catch {
    throw new Error(`Missing ${file}: run \`forge build\` in the repo root first`);
  }
}

function dep(file: string, key: string): string {
  const path = resolve(DEPLOYMENTS, file);
  try {
    const v = JSON.parse(readFileSync(path, "utf8"))[key];
    if (!v) throw new Error();
    return v;
  } catch {
    throw new Error(`Missing "${key}" in ${path}: run scripts/deploy.sh first`);
  }
}

export const ABI = {
  vault: abi("SluiceVault"),
  reserve: abi("RelayerReserve"),
  sibling: abi("SiblingVault"),
  reactive: abi("SluiceReactive"),
  usd: abi("MockUSD"),
  col: abi("MockCollateral"),
  morpho: abi("IMorpho"),
  payable: abi("IPayable"),
};

export const ADDR = {
  morpho: dep("base-market.json", "morpho") as Address,
  usd: dep("base-market.json", "mockUSD") as Address,
  col: dep("base-market.json", "mockCollateral") as Address,
  marketId: dep("base-market.json", "marketId") as Hex,
  uniUsd: dep("unichain-token.json", "mockUSD") as Address,
  reactive: dep("lasna-reactive.json", "sluiceReactive") as Address,
  vault: dep("base-sluice.json", "sluiceVault") as Address,
  reserve: dep("base-sluice.json", "relayerReserve") as Address,
  sibling: dep("unichain-sluice.json", "siblingVault") as Address,
  system: "0x8888888888888888888888888888888888888888" as Address,
  baseProxy: "0x476F44b11F5C942c58f4c8E3d0300E5710743585" as Address,
  uniProxy: "0x775c9B990ADe401060B78D0e98684eEf8d2466C1" as Address,
};
