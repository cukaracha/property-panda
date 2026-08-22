#!/usr/bin/env bash
# Point Terraform at its S3 remote backend, then `terraform init`.
#
# Usage: ./tf-init.sh
#
# The S3 backend block in terraform.tf is PARTIAL on purpose (a backend block
# cannot read variables or AppConfig.json). This script derives the state bucket
# name by convention from the AWS account id and region (no AppConfig field), and
# supplies bucket/key/region to `terraform init` via -backend-config, so state
# lives at:
#   s3://terraform-state-<account-id>-<region>/<appName>/terraform.tfstate
#
# If that bucket does not exist yet, the script creates and hardens it
# (versioning, AES256 default encryption, full public-access block). It also
# ensures the <appName>/ prefix exists (S3 has no real folders, so it writes a
# zero-byte marker on first setup). S3 is the only state source: init always runs
# with -reconfigure and any local terraform.tfstate is ignored. The script stops
# at init. Run plan/apply yourself.
#
# Two things outside this directory are also set up, so every repo on this
# machine shares one provider install instead of unpacking its own ~830MB copy:
# a plugin_cache_dir entry is added to ~/.terraformrc (once, never overriding an
# existing one), and any private .terraform/providers copy here is deleted so
# init re-links it from that shared cache.
set -euo pipefail

# Resolve paths relative to this script so it works from any working directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPCONFIG="$SCRIPT_DIR/../../AppConfig.json"
[[ -f "$APPCONFIG" ]] || { echo "ERROR: AppConfig.json not found at $APPCONFIG." >&2; exit 1; }

# Read a top-level string field from AppConfig.json (python3, so no jq dependency).
read_cfg() {
  python3 -c '
import json, sys
cfg = json.load(open(sys.argv[1]))
val = cfg.get(sys.argv[2], "")
print(val if isinstance(val, str) else "")' "$APPCONFIG" "$1"
}

APP_NAME="$(read_cfg appName)"
[[ -n "$APP_NAME" ]] || { echo "ERROR: appName is missing or empty in $APPCONFIG." >&2; exit 1; }

# Region from AppConfig.json (same source the AWS provider uses). Required — fail
# fast if absent so the state bucket can never diverge from the deploy region.
# Exported so the aws CLI calls below target it.
REGION="$(read_cfg region)"
[[ -n "$REGION" ]] || { echo "ERROR: region is missing or empty in $APPCONFIG." >&2; exit 1; }
export AWS_DEFAULT_REGION="$REGION"

# Account id from the caller's identity. Surface the real error on failure.
set +e
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text 2>&1)"
STS_RC=$?
set -e
if [[ $STS_RC -ne 0 || -z "$ACCOUNT_ID" || "$ACCOUNT_ID" == "None" ]]; then
  echo "ERROR: could not resolve the AWS account id via aws sts get-caller-identity." >&2
  echo "       $ACCOUNT_ID" >&2
  echo "       Check your AWS credentials (AWS_PROFILE / AWS_* env vars), then re-run." >&2
  exit 1
fi

# Convention: one shared state bucket per account+region, each app under its prefix.
BUCKET="terraform-state-${ACCOUNT_ID}-${REGION}"
KEY="$APP_NAME/terraform.tfstate"

# Configure the Amazon ECR docker credential helper so the tool image builds
# (terraform_data.*_build local-execs) can `docker buildx build --push` to ECR
# without `docker login`. A per-registry credHelpers entry makes docker/buildx
# fetch a fresh ECR token via docker-credential-ecr-login on each push, so nothing
# is written to the macOS keychain — parallel builds can't collide on it
# (errSecDuplicateItem -25299). credHelpers is per-registry and wins over any
# credsStore, leaving auth for other registries untouched.
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
if ! command -v docker-credential-ecr-login >/dev/null 2>&1; then
  echo "WARN: docker-credential-ecr-login not found on PATH. The tool image builds in" >&2
  echo "      'terraform apply' will fail. Install it: brew install docker-credential-helper-ecr" >&2
fi
DOCKER_CFG="${DOCKER_CONFIG:-$HOME/.docker}/config.json"
mkdir -p "$(dirname "$DOCKER_CFG")"
python3 -c '
import json, os, sys
path, reg = sys.argv[1], sys.argv[2]
cfg = {}
if os.path.exists(path) and os.path.getsize(path) > 0:
    with open(path) as f:
        cfg = json.load(f) or {}
cfg.setdefault("credHelpers", {})[reg] = "ecr-login"
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
' "$DOCKER_CFG" "$REGISTRY"
echo "==> ECR credential helper configured for $REGISTRY in $DOCKER_CFG"

# Share one provider install across every repo on this machine. Terraform
# otherwise unpacks a private copy of each provider into every working directory
# (~830MB here), so N clones cost N x 830MB. A global plugin cache holds one copy
# per provider+version+platform and init symlinks into it. Resolution mirrors
# Terraform's own precedence (TF_PLUGIN_CACHE_DIR beats the CLI config file), so
# a cache the user already chose is never overridden. Deliberately NOT
# ~/.terraform.d/plugins: that path is an implied filesystem mirror, which must
# not double as the cache. Terraform never creates this directory and silently
# skips caching when it is absent, so mkdir it before init.
TFRC="${TF_CLI_CONFIG_FILE:-$HOME/.terraformrc}"
CACHE_DIR="${TF_PLUGIN_CACHE_DIR:-}"
if [[ -z "$CACHE_DIR" && -f "$TFRC" ]]; then
  CACHE_DIR="$(sed -nE 's/^[[:space:]]*plugin_cache_dir[[:space:]]*=[[:space:]]*"([^"]*)".*/\1/p' "$TFRC" | head -1)"
fi
if [[ -z "$CACHE_DIR" ]]; then
  CACHE_DIR="$HOME/.terraform.d/plugin-cache"
  printf '\nplugin_cache_dir = "%s"\n' "$CACHE_DIR" >> "$TFRC"
  echo "==> Provider plugin cache enabled in $TFRC"
fi
CACHE_DIR="${CACHE_DIR/#\~\//$HOME/}"
CACHE_DIR="${CACHE_DIR/#\$HOME\//$HOME/}"
mkdir -p "$CACHE_DIR"
echo "==> Providers shared from $CACHE_DIR"

# 1. Ensure the bucket exists. head-bucket returns non-zero for BOTH 404 (absent)
#    and 403 (exists but not accessible), so only create on a genuine 404.
set +e
HEAD_ERR="$(aws s3api head-bucket --bucket "$BUCKET" 2>&1)"
HEAD_RC=$?
set -e
if [[ $HEAD_RC -eq 0 ]]; then
  # Bucket exists and is ours. Assert it lives in the expected region so init
  # does not later fail with a 301 PermanentRedirect.
  LOCATION="$(aws s3api get-bucket-location --bucket "$BUCKET" --query 'LocationConstraint' --output text 2>/dev/null || echo "")"
  [[ "$LOCATION" == "None" || -z "$LOCATION" ]] && LOCATION="us-east-1" # us-east-1 reports null
  if [[ "$LOCATION" != "$REGION" ]]; then
    echo "ERROR: state bucket $BUCKET is in $LOCATION but AppConfig region is $REGION." >&2
    exit 1
  fi
  echo "==> Using existing state bucket: $BUCKET"
elif [[ "$HEAD_ERR" == *"(404)"* || "$HEAD_ERR" == *"Not Found"* ]]; then
  echo "==> Creating state bucket: $BUCKET ($REGION)"
  if [[ "$REGION" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "$BUCKET" >/dev/null
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  fi
  # Harden for state storage. Non-fatal: a policy-managed bucket should not block init.
  aws s3api put-bucket-versioning --bucket "$BUCKET" \
    --versioning-configuration Status=Enabled \
    || echo "WARN: could not enable versioning on $BUCKET, set it manually." >&2
  aws s3api put-bucket-encryption --bucket "$BUCKET" \
    --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' \
    || echo "WARN: could not set default encryption on $BUCKET, set it manually." >&2
  aws s3api put-public-access-block --bucket "$BUCKET" \
    --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true \
    || echo "WARN: could not set public-access-block on $BUCKET, set it manually." >&2
else
  echo "ERROR: state bucket $BUCKET exists but is not accessible (likely owned by another account or missing s3:ListBucket)." >&2
  echo "       Details: $HEAD_ERR" >&2
  exit 1
fi

# 2. Ensure the per-app prefix exists (S3 prefixes are virtual; write a marker).
EXISTING_KEY="$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "$APP_NAME/" \
  --max-items 1 --query 'Contents[0].Key' --output text 2>/dev/null || echo "None")"
if [[ "$EXISTING_KEY" == "None" || -z "$EXISTING_KEY" ]]; then
  echo "==> First-time setup: creating s3://$BUCKET/$APP_NAME/ marker"
  aws s3api put-object --bucket "$BUCKET" --key "$APP_NAME/" >/dev/null
else
  echo "==> Reusing existing prefix: s3://$BUCKET/$APP_NAME/"
fi

# 3. Initialize the S3 backend. -reconfigure keeps S3 authoritative and never
#    migrates local state. Any stray local terraform.tfstate is ignored.
if [[ -f "$SCRIPT_DIR/terraform.tfstate" ]]; then
  echo "NOTE: a local terraform.tfstate is present. It is ignored. S3 is the only state source."
fi

# Terraform never consults the plugin cache while .terraform/providers is already
# populated ("Using previously-installed ..."), so a private copy here would keep
# this repo off the shared cache. Drop it and let init re-link from the cache, or
# fill it. -type d at depth 5 matches only real package dirs, so a repo that is
# already sharing (those entries are symlinks) is left untouched.
PROVIDERS="$SCRIPT_DIR/.terraform/providers"
if [[ -n "$(find "$PROVIDERS" -mindepth 5 -maxdepth 5 -type d -print -quit 2>/dev/null)" ]]; then
  echo "==> Removing this repo's private provider copy. Init will re-link it from $CACHE_DIR"
  rm -rf "$PROVIDERS"
fi

echo "==> terraform init -> s3://$BUCKET/$KEY"
( cd "$SCRIPT_DIR" && terraform init -reconfigure \
    -backend-config="bucket=$BUCKET" \
    -backend-config="key=$KEY" \
    -backend-config="region=$REGION" )

echo "==> Backend ready: s3://$BUCKET/$KEY"
echo "    Next, run from infra/terraform/: terraform plan, then terraform apply"
