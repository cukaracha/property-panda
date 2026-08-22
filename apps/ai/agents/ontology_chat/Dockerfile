# Ontology chat agent container for Bedrock AgentCore Runtime.
#
# A container rather than a zip, for the same reason as the ontology build agent:
# claude-agent-sdk ships no binary of its own — it is a thin wrapper that shells out
# to a `claude` CLI it locates with shutil.which() — so the runtime has to carry that
# CLI, and at ~244 MB that alone eats most of the 750 MB uncompressed ceiling for zip
# "direct code deployment".
#
# AgentCore runs containers on ARM64 (aarch64). The target arch is driven by the
# build command (`docker buildx build --platform linux/arm64 …` in
# build_agent_container.sh), NOT a hardcoded `FROM --platform=…`. The HTTP contract:
# serve 0.0.0.0:8080 with POST /invocations and GET /ping, which BedrockAgentCoreApp
# does for us.

# --- CLI stage: fetch and verify the Claude Code binary ----------------------
# Isolated so curl and the download never reach the final image. Version and
# checksum are pinned rather than tracking `stable`, so an upgrade is a reviewed
# edit and a tampered download fails the build rather than shipping. Both values
# match the ontology build agent's Dockerfile and come from:
#   https://downloads.claude.ai/claude-code-releases/<version>/manifest.json
FROM python:3.12-slim AS cli

ARG CLAUDE_CODE_VERSION=2.1.206
ARG CLAUDE_CODE_SHA256=cb8ccaf4ae6beb558747227a362010c6b32b4f4a5868c3a7e96aa9972fc6ef58

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL -o /tmp/claude \
      "https://downloads.claude.ai/claude-code-releases/${CLAUDE_CODE_VERSION}/linux-arm64/claude" \
    && echo "${CLAUDE_CODE_SHA256}  /tmp/claude" | sha256sum -c - \
    && chmod +x /tmp/claude

# --- runtime -----------------------------------------------------------------
FROM python:3.12-slim

WORKDIR /app

# /usr/local/bin is on PATH and is one of the paths the SDK's _find_cli() probes,
# so the CLI resolves even if cli_path is not passed explicitly.
COPY --from=cli /tmp/claude /usr/local/bin/claude

# Install deps first so layer caching survives source-only changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir aws-opentelemetry-distro

# Agent sources. Retrieval is entirely deterministic lookups over one artifact the
# build wrote, so there is no `shared/` here — nothing of the build pipeline's
# algorithms is needed to walk the graph it produced.
COPY main.py identity.py memory.py roles.py sdk_options.py stream_map.py prompts.json ./
COPY tools/ ./tools/

# The CLI needs a writable HOME and config dir. Each request overrides both with a
# per-session workspace so concurrent questions stay isolated; these are the fallback
# for anything that reads them before a question arrives.
ENV HOME=/tmp \
    CLAUDE_CONFIG_DIR=/tmp/.claude \
    WORKSPACE_ROOT=/tmp/ontology_chat \
    PYTHONUNBUFFERED=1

EXPOSE 8080

# OTel instrumentation lives in the CMD rather than an `entry_point`, which is a
# zip-only concept — a container runtime has no entry_point field to set it on.
CMD ["opentelemetry-instrument", "python", "main.py"]
