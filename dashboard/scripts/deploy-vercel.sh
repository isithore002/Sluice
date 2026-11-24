#!/usr/bin/env bash
# Builds the static site and deploys it to Vercel with the Vercel CLI.
#
# Why not let Vercel build it: the build step (`npm run sync`) reads ../results and ../deployments, which sit outside this
# folder, so we build here and upload the finished static export (out/) instead.
#
# Usage:   scripts/deploy-vercel.sh                      (needs `npm i -g vercel` and `vercel login` first)
# Options: VERCEL_SCOPE=<team>   the Vercel team or account to deploy under
#          DEPLOY_DIR=<path>     a folder outside git where the upload is staged and the project link is kept
#                                (default: ../.deploy, which git ignores)
set -euo pipefail
cd "$(dirname "$0")/.."

DEPLOY_DIR="${DEPLOY_DIR:-../.deploy}"
SCOPE_ARGS=()
[ -n "${VERCEL_SCOPE:-}" ] && SCOPE_ARGS=(--scope "$VERCEL_SCOPE")

npm run build

mkdir -p "$DEPLOY_DIR"
# keep .vercel (the project link) and replace everything else
find "$DEPLOY_DIR" -mindepth 1 -maxdepth 1 ! -name .vercel -exec rm -rf {} +
cp -r out/. "$DEPLOY_DIR"/
cp vercel.json "$DEPLOY_DIR"/

cd "$DEPLOY_DIR"
[ -d .vercel ] || vercel link --yes "${SCOPE_ARGS[@]}"
vercel deploy --prod --yes "${SCOPE_ARGS[@]}"
