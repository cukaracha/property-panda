"""
Web retrieve tool Lambda (Crawl4AI, headless Chromium).

Given one URL, renders it in a real headless browser (Crawl4AI + Playwright/Chromium, with
JavaScript executed) and returns the page's clean, reader-ready markdown with boilerplate
stripped. Self-hosted and keyless — no per-request quota. Retries transient failures (nav
timeout, empty content, target 5xx) with exponential backoff + jitter.

The Web Research subagent pairs this with web_search: search for candidate URLs, judge the
snippets, then retrieve only the few worth reading (fanning out one call per URL). Ships as
an x86_64 container-image Lambda with Chromium baked in.

Dual-entrypoint:
- AgentCore Gateway tool target (tool name `web_retrieve`): the gateway passes the raw tool
  args as `event` and turns the returned value into the MCP tool result, so this returns a
  BARE dict.
- REST API (API Gateway, Cognito-authorized): responds via the vendored lambda_utils with
  the {statusCode, body} envelope.
"""

import asyncio
import json
import random
from urllib.parse import urlparse

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig

import lambda_utils

MAX_RETRIES = 3
BACKOFF_BASE = 1.0
PAGE_TIMEOUT_MS = 60000
MAX_CONTENT_LENGTH = 1_000_000

# Chromium in Lambda: no sandbox (unprivileged), no /dev/shm (Lambda's is tiny — spill to
# /tmp), single process. These are mandatory for the browser to launch at all.
BROWSER_ARGS = ["--no-sandbox", "--disable-dev-shm-usage", "--single-process"]


async def crawl_once(url: str) -> str:
    """Render one URL with Crawl4AI and return its clean markdown, or raise on failure."""
    browser_config = BrowserConfig(headless=True, extra_args=BROWSER_ARGS)
    run_config = CrawlerRunConfig(cache_mode=CacheMode.BYPASS, page_timeout=PAGE_TIMEOUT_MS)

    async with AsyncWebCrawler(config=browser_config) as crawler:
        result = await crawler.arun(url=url, config=run_config)

    if not result.success:
        raise RuntimeError(result.error_message or "crawl failed")

    # crawl4ai returns a MarkdownGenerationResult (fit_markdown = noise-filtered,
    # raw_markdown = full) on modern versions, or a plain string on older ones.
    markdown = result.markdown
    if isinstance(markdown, str):
        content = markdown
    else:
        content = getattr(markdown, "fit_markdown", "") or getattr(markdown, "raw_markdown", "")

    content = (content or "").strip()
    if not content:
        raise RuntimeError("empty content")
    return content


async def main(url: str) -> dict:
    """Fetch one URL and return its clean markdown, retrying transient failures with backoff."""
    url = (url or "").strip()
    if not url:
        return {"error": "url is required"}

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return {"error": "url must be a valid http(s) URL", "url": url}

    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            content = await crawl_once(url)
            raw_length = len(content)
            result = {
                "url": url,
                "fetcher": "crawl4ai",
                "content": content[:MAX_CONTENT_LENGTH],
                "content_length": raw_length,
            }
            if raw_length > MAX_CONTENT_LENGTH:
                result["truncated"] = True
            return result
        except Exception as e:
            last_error = str(e)
            if attempt < MAX_RETRIES - 1:
                await asyncio.sleep(BACKOFF_BASE * (2 ** attempt) + random.uniform(0, BACKOFF_BASE))

    return {"error": "web_retrieve failed", "url": url, "details": last_error}


def extract_url(event) -> str:
    """Read the url arg from a gateway event (raw args) or a REST event (body/query)."""
    if isinstance(event.get("body"), str):
        try:
            body = json.loads(event["body"]) if event["body"] else {}
        except json.JSONDecodeError:
            body = {}
    else:
        body = event.get("body") or {}

    params = event.get("queryStringParameters") or {}
    return event.get("url") or body.get("url") or params.get("url") or ""


def lambda_handler(event, context):
    # AgentCore Gateway tool path: bare dict out (no statusCode/body envelope).
    if lambda_utils.is_gateway_invocation(event, context):
        return asyncio.run(main(event.get("url", "")))

    # REST API path: CORS preflight + {statusCode, body} envelope via lambda_utils.
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        return lambda_utils.success_response(asyncio.run(main(extract_url(event))))
    except Exception as e:
        print(f"Error running web retrieve: {str(e)}")
        return lambda_utils.server_error(str(e))
