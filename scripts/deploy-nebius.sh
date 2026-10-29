#!/usr/bin/env bash
# Deploy Vouch to Nebius Serverless AI as a public CPU endpoint.
#
# Prerequisites:
#   - Docker running, Nebius CLI installed and configured (`nebius profile create`)
#   - A Nebius Container Registry: `nebius registry create --name vouch`
#   - NEBIUS_API_KEY and TAVILY_API_KEY exported (GITHUB_TOKEN optional)
#
# Usage:
#   REGISTRY=cr.eu-north1.nebius.cloud/<registry-id> ./scripts/deploy-nebius.sh
set -euo pipefail

: "${REGISTRY:?set REGISTRY, e.g. cr.eu-north1.nebius.cloud/<registry-id>}"
: "${NEBIUS_API_KEY:?export NEBIUS_API_KEY (Token Factory key)}"
: "${TAVILY_API_KEY:?export TAVILY_API_KEY}"
NAME="${NAME:-vouch}"
PLATFORM="${PLATFORM:-cpu-d3}"
PRESET="${PRESET:-4vcpu-16gb}"
TAG="$(git rev-parse --short HEAD)"
IMAGE="$REGISTRY/vouch:$TAG"

echo "Building $IMAGE"
docker build --platform linux/amd64 -t "$IMAGE" .
nebius iam get-access-token | docker login "${REGISTRY%%/*}" --username iam --password-stdin
docker push "$IMAGE"

ENV_ARGS=(--env "NEBIUS_API_KEY=$NEBIUS_API_KEY" --env "TAVILY_API_KEY=$TAVILY_API_KEY")
[ -n "${GITHUB_TOKEN:-}" ] && ENV_ARGS+=(--env "GITHUB_TOKEN=$GITHUB_TOKEN")

if ID=$(nebius ai endpoint get-by-name --name "$NAME" --format jsonpath='{.metadata.id}' 2>/dev/null) && [ -n "$ID" ]; then
  echo "Updating endpoint $ID"
  nebius ai endpoint update "$ID" --image "$IMAGE" "${ENV_ARGS[@]}"
else
  echo "Creating endpoint $NAME"
  # Public web app, so no endpoint-level auth; the app rate-limits /api itself.
  nebius ai endpoint create \
    --name "$NAME" \
    --image "$IMAGE" \
    --platform "$PLATFORM" \
    --preset "$PRESET" \
    --public \
    --container-port 3000 \
    "${ENV_ARGS[@]}"
  ID=$(nebius ai endpoint get-by-name --name "$NAME" --format jsonpath='{.metadata.id}')
fi

echo "Waiting for a public address..."
for _ in $(seq 1 60); do
  ADDR=$(nebius ai endpoint get "$ID" --format jsonpath='{.status.public_endpoints[0]}' 2>/dev/null || true)
  [ -n "$ADDR" ] && break
  sleep 5
done
[ -n "${ADDR:-}" ] || { echo "No public address yet. Check: nebius ai endpoint logs $ID"; exit 1; }
URL="http://$ADDR"
echo "Endpoint: $URL"
for _ in $(seq 1 30); do curl -fsS -o /dev/null "$URL" && break; sleep 5; done
SMOKE_BASE="$URL" bun scripts/smoke.ts
