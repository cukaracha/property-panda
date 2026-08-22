# web_retrieve container image — Crawl4AI + Playwright + Chromium turned into a Lambda.
# Unlike the other OSINT container tools (which build on the AWS Lambda Python base and
# shell out to a keyless binary), this one bases on the upstream Crawl4AI image: it is
# Debian-based with Playwright/Chromium already installed and its system libraries
# dep-satisfied, which is the hard part to reproduce on Amazon Linux. We turn it into a
# Lambda container by adding the Lambda Runtime Interface Client (awslambdaric).
# See apps/ai/tools/osint/web_retrieve/web_retrieve.py.
FROM unclecode/crawl4ai:latest

# The crawl4ai base image ends on `USER appuser` (non-root). Switch back to root so the
# steps below can write system site-packages (awslambdaric on sys.path at runtime) and
# create /ms-playwright. Lambda sandboxes the container, so a root runtime user is fine —
# it matches the AWS base the other OSINT container tools use.
USER root

WORKDIR /var/task

# Speak the Lambda runtime API from this non-AWS base image.
COPY requirements-lambda.txt ./
RUN pip install --no-cache-dir -r requirements-lambda.txt

# Lambda's filesystem is read-only except /tmp, so point every writable location (HOME,
# XDG caches, crawl4ai's DB dir) at /tmp. Pin the Playwright browsers to a fixed,
# HOME-independent path and (re)install Chromium there so it is still found after HOME is
# relocated at runtime. --shm-size is a `docker run` flag Lambda can't set, hence the
# --disable-dev-shm-usage browser arg in the handler.
ENV HOME=/tmp \
    XDG_CONFIG_HOME=/tmp \
    XDG_CACHE_HOME=/tmp \
    CRAWL4_AI_BASE_DIRECTORY=/tmp \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN playwright install chromium

COPY web_retrieve.py lambda_utils.py ./

# Lambda Runtime Interface Client entrypoint; CMD is the handler.
ENTRYPOINT ["python", "-m", "awslambdaric"]
CMD ["web_retrieve.lambda_handler"]
