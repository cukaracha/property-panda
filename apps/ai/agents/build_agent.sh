#!/usr/bin/env bash
# Build build/agent.zip for a Bedrock AgentCore agent ("direct code deployment").
#
# Usage: ./build_agent.sh <agent-dir>
#   e.g. ./build_agent.sh chat   →  builds ai/agents/chat into ai/agents/chat/build/agent.zip
#
# <agent-dir> is resolved relative to THIS script's directory, so the one script
# builds any agent under ai/agents/. AgentCore runtimes run on ARM64 (aarch64),
# so we download aarch64 wheels for the target Python version regardless of the
# host platform (works from macOS). The archive is laid out with the agent's
# *.py and *.json plus all deps at its ROOT.
#
# Invoked by Terraform's `terraform_data.*_build` whenever the agent sources or
# this script change. Also safe to run standalone for the manual two-step flow:
#   ./build_agent.sh chat && terraform apply
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <agent-dir>   (e.g. $0 chat)" >&2
  exit 1
fi

# Resolve paths relative to this script so it works from any working directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$SCRIPT_DIR/$1"
BUILD_DIR="$AGENT_DIR/build"
PKG_DIR="$BUILD_DIR/package"
ZIP_PATH="$BUILD_DIR/agent.zip"

if [[ ! -d "$AGENT_DIR" ]]; then
  echo "Agent directory not found: $AGENT_DIR" >&2
  exit 1
fi

# Must match `runtime = "PYTHON_3_12"` in ai_agents.tf.
PYTHON_VERSION="3.12"

echo "==> Cleaning $BUILD_DIR"
rm -rf "$BUILD_DIR"
mkdir -p "$PKG_DIR"

echo "==> Installing ARM64 (aarch64) deps for Python $PYTHON_VERSION"
python3 -m pip install \
  --requirement "$AGENT_DIR/requirements.txt" \
  --target "$PKG_DIR" \
  --platform manylinux2014_aarch64 \
  --implementation cp \
  --python-version "$PYTHON_VERSION" \
  --only-binary=:all: \
  --upgrade

echo "==> Copying agent source"
cp "$AGENT_DIR"/*.py "$PKG_DIR/"

# Copy any data files (e.g. prompts.json) if the agent has them.
shopt -s nullglob
json_files=("$AGENT_DIR"/*.json)
if (( ${#json_files[@]} )); then
  cp "${json_files[@]}" "$PKG_DIR/"
fi
shopt -u nullglob

echo "==> Zipping to $ZIP_PATH"
( cd "$PKG_DIR" && zip -r -q "$ZIP_PATH" . -x '*.pyc' '*__pycache__*' )

echo "==> Done"
ls -lh "$ZIP_PATH"
