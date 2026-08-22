#!/usr/bin/env bash
# Build & push an ARM64 container image for a Bedrock AgentCore A2A agent.
#
# Usage: ./build_agent_container.sh <agent-dir> <repo-url> <tag> <region>
#   e.g. ./build_agent_container.sh number_specialist 123456789012.dkr.ecr.ap-southeast-2.amazonaws.com/dev-foo-number-specialist abc123 ap-southeast-2
#
# <agent-dir> is resolved relative to THIS script's directory, so one script builds
# any container agent under ai/agents/. AgentCore runtimes run on ARM64 (aarch64),
# so we always build linux/arm64 via buildx (works from an Intel/Apple-silicon mac;
# Intel hosts need qemu/binfmt for cross-build). The image is tagged with a content
# hash (the caller passes it) and pushed to ECR — never `:latest`, so a code change
# yields a new immutable URI that busts AgentCore's image cache.
#
# Invoked by Terraform's `terraform_data.subagent_build` whenever the agent sources,
# Dockerfile, requirements, or this script change. Safe to run standalone too.
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "Usage: $0 <agent-dir> <repo-url> <tag> <region>" >&2
  exit 1
fi

AGENT="$1"
REPO_URL="$2"
TAG="$3"
REGION="$4"  # kept for the documented 4-arg signature; auth comes from the credHelper

# Resolve the agent dir relative to this script so it works from any CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$SCRIPT_DIR/$AGENT"

if [[ ! -d "$AGENT_DIR" ]]; then
  echo "Agent directory not found: $AGENT_DIR" >&2
  exit 1
fi

# Delegate to the shared, cache-capped build helper — ARM64 for AgentCore runtimes.
# Every docker build in the repo shares one bounded builder. No --ecr-login: tf-init.sh
# installs the per-registry ecr-login credHelper, which mints a fresh token on each push.
# (`docker login` would fail against it anyway — the helper implements no `store` verb.)
exec "$SCRIPT_DIR/../../../scripts/build_container_image.sh" \
  --context "$AGENT_DIR" --tag "${REPO_URL}:${TAG}" \
  --platform linux/arm64
