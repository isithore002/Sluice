#!/usr/bin/env bash
# Deploys and seeds Sluice across Base Sepolia, Unichain Sepolia and Reactive Lasna, in the order the Reactive docs
# require (reactive contract first, then the callback contracts that trust it, then subscriptions, then seed).
# Usage: scripts/deploy.sh [first_step]   e.g. scripts/deploy.sh 4  to resume from step 4.
set -euo pipefail
cd "$(dirname "$0")/.."

# ENV_FILE lets a rehearsal point at local forks without touching .env.
ENV_FILE="${ENV_FILE:-.env}"
if [ ! -f "$ENV_FILE" ]; then echo "Missing $ENV_FILE (copy .env.example to .env and set PRIVATE_KEY)"; exit 1; fi
set -a; source "$ENV_FILE"; set +a
: "${PRIVATE_KEY:?PRIVATE_KEY is not set in .env}"
mkdir -p deployments

FIRST="${1:-1}"
# Extra flags for Lasna if its RPC needs them (e.g. LASNA_FLAGS="--legacy").
LASNA_FLAGS="${LASNA_FLAGS:-}"

step() {
  local n="$1" desc="$2" target="$3" rpc="$4" extra="${5:-}"
  if [ "$n" -lt "$FIRST" ]; then return; fi
  echo
  echo "=== Step $n/9: $desc"
  # shellcheck disable=SC2086
  forge script "$target" --rpc-url "$rpc" --broadcast --slow $extra
}

step 1 "Base Sepolia: mock tokens, oracle, Morpho market" script/01_DeployMarket.s.sol:DeployMarket "$BASE_SEPOLIA_RPC"
step 2 "Unichain Sepolia: MockUSD" script/02_DeployUniToken.s.sol:DeployUniToken "$UNICHAIN_SEPOLIA_RPC"
step 3 "Lasna: SluiceReactive (funded)" script/03_DeployReactive.s.sol:DeployReactive "$LASNA_RPC" "$LASNA_FLAGS"
step 4 "Base Sepolia: SluiceVault + RelayerReserve" script/04_DeployBase.s.sol:DeployBase "$BASE_SEPOLIA_RPC"
step 5 "Unichain Sepolia: SiblingVault" script/05_DeployUni.s.sol:DeployUni "$UNICHAIN_SEPOLIA_RPC"
step 6 "Lasna: configure subscriptions" script/06_Configure.s.sol:Configure "$LASNA_RPC" "$LASNA_FLAGS"
step 7 "Base Sepolia: seed (vault deposit, competitor supply, reserve, borrow to 100%)" script/07_SeedBase.s.sol:SeedBase "$BASE_SEPOLIA_RPC"
step 8 "Unichain Sepolia: seed sibling + commit credit" script/08_SeedUni.s.sol:SeedUni "$UNICHAIN_SEPOLIA_RPC"
step 9 "Base Sepolia: one-click repay helper for the dashboard" script/09_DeployOneClick.s.sol:DeployOneClick "$BASE_SEPOLIA_RPC"

echo
echo "Done. Addresses are in deployments/*.json"
