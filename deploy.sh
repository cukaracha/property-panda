#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# Print commands and their arguments as they are executed (for debugging)
set -x

# Function to show stack trace on error
show_error() {
    echo "Error occurred in deployment script!"
    echo "Stack trace:"
    local frame=0
    while caller $frame; do
        ((frame++))
    done
    echo "Deployment failed at line $1"
    exit 1
}

# Trap errors and show stack trace
trap 'show_error $LINENO' ERR

# ============================================================================
# Configuration
# ============================================================================

# This script is the canonical deploy entry point and lives at the repo root.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
CDK_DIR="$REPO_ROOT/infra/cdk"
CONFIG_FILE="${REPO_ROOT}/AppConfig.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "ERROR: AppConfig.json not found at $CONFIG_FILE"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "ERROR: jq is required but not installed"
    exit 1
fi

STAGE=$(jq -r '.stage // "dev"' "$CONFIG_FILE")
APP_NAME=$(jq -r '.appName' "$CONFIG_FILE")
DISPLAY_NAME=$(jq -r '.displayName // .appName' "$CONFIG_FILE")

CORE_STACK="${STAGE}-${APP_NAME}-CoreStack"
DATA_STACK="${STAGE}-${APP_NAME}-DataStack"
AI_STACK="${STAGE}-${APP_NAME}-AiStack"
API_STACK="${STAGE}-${APP_NAME}-ApiStack"
UI_STACK="${STAGE}-${APP_NAME}-UiStack"

REGION=$(jq -r '.region // empty' "$CONFIG_FILE")
REGION=${REGION:-${CDK_DEFAULT_REGION:-us-east-1}}

# ============================================================================
# Function Definitions
# ============================================================================

# bin/infra.ts constructs every stack on any cdk command, and the AI stack's
# BucketDeployments stage the gitignored chat agent + number_specialist subagent
# zips at synth time — so both zips must exist before deploying ANY stack.
ensure_agent_zip() {
    if [ ! -f "$REPO_ROOT/apps/ai/agents/chat/build/agent.zip" ]; then
        echo "Chat agent zip missing — building it..."
        "$REPO_ROOT/apps/ai/agents/build_agent.sh" chat
    fi
    if [ ! -f "$REPO_ROOT/apps/ai/agents/number_specialist/build/agent.zip" ]; then
        echo "number_specialist subagent zip missing — building it..."
        "$REPO_ROOT/apps/ai/agents/build_agent.sh" number_specialist
    fi
}

deploy_core() {
    echo "Deploying core stack..."
    ensure_agent_zip
    cd "$CDK_DIR"
    npx cdk deploy "$CORE_STACK" --exclusively --require-approval never
    cd - > /dev/null
}

deploy_data() {
    echo "Deploying data stack..."
    ensure_agent_zip
    cd "$CDK_DIR"
    npx cdk deploy "$DATA_STACK" --exclusively --require-approval never
    cd - > /dev/null
}

deploy_ai() {
    echo "Deploying AI stack..."

    # The chat agent + number_specialist subagent each ship as a pre-built zip
    # (gitignored) — build them before the stack's BucketDeployments stage them.
    "$REPO_ROOT/apps/ai/agents/build_agent.sh" chat
    "$REPO_ROOT/apps/ai/agents/build_agent.sh" number_specialist

    cd "$CDK_DIR"
    npx cdk deploy "$AI_STACK" --exclusively --require-approval never
    cd - > /dev/null
}

deploy_api() {
    echo "Deploying API stack..."
    ensure_agent_zip
    cd "$CDK_DIR"
    npx cdk deploy "$API_STACK" --exclusively --require-approval never
    cd - > /dev/null
}

update_env_file() {
    echo "Updating .env.production file with infrastructure outputs..."

    USER_POOL_ID=$(aws cloudformation describe-stacks \
        --stack-name "$CORE_STACK" \
        --region "$REGION" \
        --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
        --output text)

    USER_POOL_CLIENT_ID=$(aws cloudformation describe-stacks \
        --stack-name "$CORE_STACK" \
        --region "$REGION" \
        --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" \
        --output text)

    API_ENDPOINT=$(aws cloudformation describe-stacks \
        --stack-name "$API_STACK" \
        --region "$REGION" \
        --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
        --output text)

    if [ -z "$USER_POOL_ID" ] || [ "$USER_POOL_ID" = "None" ]; then
        echo "ERROR: Failed to retrieve UserPoolId from $CORE_STACK"
        exit 1
    fi

    if [ -z "$USER_POOL_CLIENT_ID" ] || [ "$USER_POOL_CLIENT_ID" = "None" ]; then
        echo "ERROR: Failed to retrieve UserPoolClientId from $CORE_STACK"
        exit 1
    fi

    if [ -z "$API_ENDPOINT" ] || [ "$API_ENDPOINT" = "None" ]; then
        echo "ERROR: Failed to retrieve ApiEndpoint from $API_STACK"
        exit 1
    fi

    AGENTCORE_RUNTIME_ARN=$(aws cloudformation describe-stacks \
        --stack-name "$AI_STACK" \
        --region "$REGION" \
        --query "Stacks[0].Outputs[?OutputKey=='ChatAgentRuntimeArn'].OutputValue" \
        --output text 2>/dev/null || echo "")

    # The ontology page invokes its own retrieval runtime directly, the same way
    # the chat page invokes the chat runtime.
    ONTOLOGY_AGENT_RUNTIME_ARN=$(aws cloudformation describe-stacks \
        --stack-name "$AI_STACK" \
        --region "$REGION" \
        --query "Stacks[0].Outputs[?OutputKey=='OntologyChatRuntimeArn'].OutputValue" \
        --output text 2>/dev/null || echo "")

    # Federated SSO is enabled only when AppConfig.json sets both federatedIdp
    # fields. When enabled, read the hosted-UI base URL and strip the scheme so
    # the SPA gets the bare Cognito domain host (VITE_COGNITO_DOMAIN).
    FEDERATED_ISSUER=$(jq -r '.federatedIdp.issuerUrl // empty' "$CONFIG_FILE")
    FEDERATED_CLIENT=$(jq -r '.federatedIdp.clientId // empty' "$CONFIG_FILE")
    COGNITO_DOMAIN=""
    if [ -n "$FEDERATED_ISSUER" ] && [ -n "$FEDERATED_CLIENT" ]; then
        DOMAIN_BASE_URL=$(aws cloudformation describe-stacks \
            --stack-name "$CORE_STACK" \
            --region "$REGION" \
            --query "Stacks[0].Outputs[?OutputKey=='CognitoUserPoolDomainBaseUrl'].OutputValue" \
            --output text)
        COGNITO_DOMAIN="${DOMAIN_BASE_URL#https://}"
    fi

    cat > "$REPO_ROOT/apps/ui/web/.env.production" << EOF
VITE_AWS_REGION=$REGION
VITE_USER_POOL_ID=$USER_POOL_ID
VITE_USER_POOL_CLIENT_ID=$USER_POOL_CLIENT_ID
VITE_API_URL=$API_ENDPOINT
VITE_AGENTCORE_RUNTIME_ARN=$AGENTCORE_RUNTIME_ARN
VITE_ONTOLOGY_AGENT_RUNTIME_ARN=$ONTOLOGY_AGENT_RUNTIME_ARN
VITE_APP_NAME=$DISPLAY_NAME
EOF

    # Append only when enabled — its presence is what turns on the SPA SSO button.
    if [ -n "$COGNITO_DOMAIN" ]; then
        echo "VITE_COGNITO_DOMAIN=$COGNITO_DOMAIN" >> "$REPO_ROOT/apps/ui/web/.env.production"
    fi

    echo "Updated apps/ui/web/.env.production:"
    echo "  VITE_AWS_REGION=$REGION"
    echo "  VITE_USER_POOL_ID=$USER_POOL_ID"
    echo "  VITE_USER_POOL_CLIENT_ID=$USER_POOL_CLIENT_ID"
    echo "  VITE_API_URL=$API_ENDPOINT"
    echo "  VITE_AGENTCORE_RUNTIME_ARN=$AGENTCORE_RUNTIME_ARN"
    echo "  VITE_ONTOLOGY_AGENT_RUNTIME_ARN=$ONTOLOGY_AGENT_RUNTIME_ARN"
    echo "  VITE_APP_NAME=$DISPLAY_NAME"
    if [ -n "$COGNITO_DOMAIN" ]; then
        echo "  VITE_COGNITO_DOMAIN=$COGNITO_DOMAIN"
    fi
}

deploy_ui_stack() {
    echo "Deploying UI stack..."
    ensure_agent_zip
    cd "$CDK_DIR"
    npx cdk deploy "$UI_STACK" --exclusively --require-approval never
    cd - > /dev/null
}

deploy_ui() {
    update_env_file
    deploy_ui_stack

    CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
        --stack-name "$UI_STACK" \
        --region "$REGION" \
        --query "Stacks[0].Outputs[?OutputKey=='CloudFrontUrl'].OutputValue" \
        --output text)

    echo ""
    echo "App URL: $CLOUDFRONT_URL"
}

main() {
    echo "Starting full deployment..."
    echo "Stage: $STAGE | App: $APP_NAME | Region: $REGION"

    # Phase 1: Foundation stacks (no inter-dependencies)
    deploy_core
    deploy_data

    # Phase 2: AI stack (depends on CoreStack + DataStack)
    deploy_ai

    # Phase 3: API stack (depends on CoreStack + AiStack)
    deploy_api

    # Phase 4: UI stack (env from CoreStack + ApiStack + AiStack outputs)
    deploy_ui

    echo "Deployment completed successfully!"
}

# ============================================================================
# Parameter Handling
# ============================================================================

# Usage: ./deploy.sh [profile=<name>] [stack=<name>]
# Examples:
#   ./deploy.sh                        Deploy all stacks with default profile
#   ./deploy.sh stack=core             Deploy core stack only
#   ./deploy.sh stack=ui               Deploy UI (env + deploy)
#   ./deploy.sh profile=dev stack=api  Deploy API stack with "dev" profile

PROFILE=""
STACK_NAME=""

for arg in "$@"; do
    case $arg in
        profile=*)
            PROFILE="${arg#*=}"
            ;;
        stack=*)
            STACK_NAME="${arg#*=}"
            ;;
        *)
            echo "ERROR: Invalid parameter '$arg'"
            echo "Usage: ./deploy.sh [profile=<name>] [stack=<name>]"
            echo "  profile: AWS profile name (optional)"
            echo "  stack:   core, data, ai, api, ui, or all (optional, default: all)"
            exit 1
            ;;
    esac
done

if [ ! -z "$PROFILE" ]; then
    export AWS_PROFILE=$PROFILE
    echo "Using AWS profile: $AWS_PROFILE"
else
    echo "Using default/current AWS profile"
fi

# Validate stack name
if [ ! -z "$STACK_NAME" ]; then
    case "$STACK_NAME" in
        core|data|ai|api|ui|all) ;;
        *)
            echo "ERROR: Invalid stack name '$STACK_NAME'"
            echo "Valid options: core, data, ai, api, ui, all"
            exit 1
            ;;
    esac
fi

# Execute deployment
case $STACK_NAME in
    core)   deploy_core ;;
    data)   deploy_data ;;
    ai)     deploy_ai ;;
    api)    deploy_api ;;
    ui)     deploy_ui ;;
    all)    main ;;
    "")     main ;;
esac
