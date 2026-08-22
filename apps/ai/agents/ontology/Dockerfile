# Ontology agent container for Bedrock AgentCore Runtime.
#
# This agent is a container rather than a zip, unlike chat and number_specialist.
# claude-agent-sdk ships no binary of its own — it is a thin wrapper that shells out
# to a `claude` CLI it locates with shutil.which() — so the runtime has to carry that
# CLI. At ~244 MB that alone eats most of the 750 MB uncompressed ceiling for zip
# "direct code deployment", before numpy and scipy. A container has no such ceiling
# and sets the binary's exec bit natively rather than relying on it surviving a zip
# round-trip.
#
# AgentCore runs containers on ARM64 (aarch64). The target arch is driven by the
# build command (`docker buildx build --platform linux/arm64 …` in
# build_agent_container.sh), NOT a hardcoded `FROM --platform=…` (which Docker flags
# as an anti-pattern). The HTTP contract: serve 0.0.0.0:8080 with POST /invocations
# and GET /ping, which BedrockAgentCoreApp does for us.

# --- CLI stage: fetch and verify the Claude Code binary ----------------------
# Isolated so curl and the download never reach the final image. Version and
# checksum are pinned rather than tracking `stable`, so an upgrade is a reviewed
# edit and a tampered download fails the build rather than shipping.
# Both values come from:
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

# Agent sources. `shared/` carries the deterministic algorithms the retired Step
# Functions pipeline ran — chunking, keying, anchor matching, telemetry — so the
# port changed which model does the reasoning, not how an extraction is verified.
COPY main.py run_store.py sdk_options.py stream_map.py prompts.json ./
COPY shared/ ./shared/
COPY tools/ ./tools/

# The CLI needs a writable HOME and config dir. execute_build overrides both per
# build with a per-build workspace so concurrent builds stay isolated; these are
# the fallback for anything that reads them before a build starts.
ENV HOME=/tmp \
    CLAUDE_CONFIG_DIR=/tmp/.claude \
    WORKSPACE_ROOT=/tmp/ontology \
    PYTHONUNBUFFERED=1

EXPOSE 8080

# OTel instrumentation lives in the CMD rather than an `entry_point`, which is a
# zip-only concept — a container runtime has no entry_point field to set it on.
CMD ["opentelemetry-instrument", "python", "main.py"]
