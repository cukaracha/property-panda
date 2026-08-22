#!/usr/bin/env bash
# Build & push a container image to ECR through ONE shared, cache-capped buildx builder.
# EVERY shell/terraform-local-exec docker build in this repo goes through this helper
# (the 3 tool images + the AgentCore agent container), so the whole repo shares ONE
# docker-container builder whose cache is bounded — previously each build created its own
# unbounded builder and their combined cache filled the Docker Desktop VM disk. (CDK's
# fromImageAsset builds use Docker's DEFAULT builder, bounded separately by
# ~/.docker/daemon.json builder.gc.)
#
# Usage: build_container_image.sh --context <dir> --tag <image-uri> \
#          [--file <dockerfile>] [--platform <plat>] [--ecr-login <region>] \
#          [--builder <name>] [--keep-storage <size>]
#   --platform     default linux/amd64; agents pass linux/arm64.
#   --ecr-login    region; when set, `docker login`s to the tag's registry first.
#                  Omit when relying on the ECR credHelper (tf-init.sh writes it).
#   --builder      default <stage>-<appname>-builder from AppConfig.json.
#   --keep-storage BuildKit cache kept after each build; default 10GB.
set -euo pipefail

CONTEXT=""; TAG=""; FILE=""; PLATFORM="linux/amd64"; ECR_LOGIN=""; BUILDER=""; KEEP_STORAGE="10GB"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --context)      CONTEXT="$2"; shift 2 ;;
    --tag)          TAG="$2"; shift 2 ;;
    --file)         FILE="$2"; shift 2 ;;
    --platform)     PLATFORM="$2"; shift 2 ;;
    --ecr-login)    ECR_LOGIN="$2"; shift 2 ;;
    --builder)      BUILDER="$2"; shift 2 ;;
    --keep-storage) KEEP_STORAGE="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done
if [[ -z "$CONTEXT" || -z "$TAG" ]]; then
  echo "Usage: $0 --context <dir> --tag <image-uri> [--file <dockerfile>] [--platform <plat>] [--ecr-login <region>] [--builder <name>] [--keep-storage <size>]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default the shared builder name from AppConfig.json (python-no-jq idiom, per tf-init.sh)
# so it follows {stage}-{appname}-{type} and is identical for every repo docker build.
if [[ -z "$BUILDER" ]]; then
  APPCONFIG="$SCRIPT_DIR/../AppConfig.json"
  [[ -f "$APPCONFIG" ]] || { echo "AppConfig.json not found at $APPCONFIG" >&2; exit 1; }
  BUILDER="$(python3 -c '
import json, sys
cfg = json.load(open(sys.argv[1]))
stage = cfg.get("stage", "dev")
app = cfg["appName"]
print((stage + "-" + app + "-builder").lower())' "$APPCONFIG")"
fi

if [[ -n "$ECR_LOGIN" ]]; then
  REGISTRY="${TAG%%/*}"
  echo "==> Logging in to ECR registry: $REGISTRY"
  aws ecr get-login-password --region "$ECR_LOGIN" | docker login --username AWS --password-stdin "$REGISTRY"
fi

# Idempotently create ONE shared docker-container builder with BuildKit GC on so a fresh
# builder self-caps between prunes. (Older BuildKit <v0.13 rejects the string
# gckeepstorage; if that ever bites, drop --buildkitd-config — the post-build prune is the
# real guarantee.) One docker-container builder + qemu builds both amd64 and arm64.
if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  echo "==> Creating shared buildx builder: $BUILDER (cache cap $KEEP_STORAGE)"
  BUILDKITD_TOML="$(mktemp)"; trap 'rm -f "$BUILDKITD_TOML"' EXIT
  printf '[worker.oci]\n  gc = true\n  gckeepstorage = "%s"\n' "$KEEP_STORAGE" > "$BUILDKITD_TOML"
  # Terraform runs this helper in parallel (default -parallelism=10), so several invocations
  # can clear the inspect guard above together and then all race to `create` the SAME builder
  # name. Docker makes create atomic — exactly one wins; the losers fail with "existing
  # instance ... but no append mode". flock isn't available on macOS, so rather than lock we
  # tolerate the race: if create fails, re-inspect. If a peer already made the builder, adopt
  # it and --bootstrap to wait until its buildkitd is running; only a genuine failure (builder
  # still absent) is fatal. stderr is captured so a real error isn't masked by this handling.
  if ! create_err="$(docker buildx create --name "$BUILDER" --driver docker-container --buildkitd-config "$BUILDKITD_TOML" --bootstrap 2>&1)"; then
    if docker buildx inspect --bootstrap "$BUILDER" >/dev/null 2>&1; then
      echo "==> Adopted shared buildx builder created by a concurrent build: $BUILDER"
    else
      echo "$create_err" >&2
      echo "==> Failed to create shared buildx builder: $BUILDER" >&2
      exit 1
    fi
  fi
else
  echo "==> Reusing shared buildx builder: $BUILDER"
fi

# --builder per-invocation (not `buildx use`) so we don't clobber the dev's default.
# Array keeps optional --file safe under `set -u` on macOS bash 3.2.
build_cmd=(docker buildx build --builder "$BUILDER" --platform "$PLATFORM" --provenance=false --sbom=false)
[[ -n "$FILE" ]] && build_cmd+=(--file "$FILE")
build_cmd+=(--tag "$TAG" --push "$CONTEXT")
echo "==> Building & pushing $PLATFORM image: $TAG"
"${build_cmd[@]}"

# Deterministic cap after every build — enforces the limit even on a pre-existing builder,
# so repeated builds can never fill the VM disk.
echo "==> Pruning $BUILDER build cache to <= $KEEP_STORAGE"
docker buildx prune --builder "$BUILDER" --force --keep-storage "$KEEP_STORAGE"
echo "==> Done: $TAG"
