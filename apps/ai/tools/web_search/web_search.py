"""
Web search tool Lambda (Brave Search API).

Given a query, calls the Brave Search API and returns lightweight candidate results
(title, url, snippet) — metadata only, never page bodies. Retries Brave on HTTP 429/5xx
with exponential backoff + jitter, and fails gracefully when the key is unset. With
llm_eval=true it runs a fast Bedrock relevance pass over the candidates (via the shared
aws_utils.bedrock_utils.converse_text helper, which fails over across Claude models on
throttling) and returns only the relevant ones, each with a why_relevant; the default
(llm_eval=false) returns the raw candidates for the caller to judge.

Reads BRAVE_API_KEY from the api-keys secret (SECRET_ARN). The Web Research subagent pairs
this with web_retrieve: search for candidate URLs, then read the few worth reading.

Dual-entrypoint:
- AgentCore Gateway tool target (tool name `web_search`): the gateway passes the raw tool
  args as `event` and turns the returned value into the MCP tool result, so this returns a
  BARE dict.
- REST API (API Gateway, Cognito-authorized): responds via the aws_utils layer with the
  {statusCode, body} envelope.
"""

import json
import os
import random
import time
import urllib.error
import urllib.parse
import urllib.request

from aws_utils import lambda_utils
from aws_utils import secrets_utils

BRAVE_URL = "https://api.search.brave.com/res/v1/web/search"
HTTP_TIMEOUT = 15
MAX_CANDIDATES = 10
MAX_RETRIES = 3
BACKOFF_BASE = 0.5
RETRYABLE_STATUS = {429, 500, 502, 503, 504}
USER_AGENT = "osint-platform/1.0 (+web-search)"

SECRET_ARN = os.environ.get("SECRET_ARN", "")


def load_keys() -> dict:
    """Read the api-keys secret JSON (BRAVE_API_KEY lives here); {} when unavailable."""
    if not SECRET_ARN:
        return {}
    try:
        return json.loads(secrets_utils.get_secret(SECRET_ARN))
    except Exception:
        return {}


def fetch_brave(query: str, key: str) -> list:
    """One Brave web-search call → candidate list [{title, url, snippet}] (metadata only)."""
    params = urllib.parse.urlencode({"q": query, "count": MAX_CANDIDATES})
    request = urllib.request.Request(
        f"{BRAVE_URL}?{params}",
        headers={
            "X-Subscription-Token": key,
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        data = json.loads(response.read().decode("utf-8", errors="replace"))

    candidates = []
    for item in (data.get("web", {}).get("results") or [])[:MAX_CANDIDATES]:
        candidates.append({
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "snippet": item.get("description", ""),
        })
    return candidates


def fetch_brave_with_retry(query: str, key: str) -> list:
    """Call Brave with a bounded exponential backoff + jitter on HTTP 429/5xx or transport errors."""
    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            return fetch_brave(query, key)
        except urllib.error.HTTPError as e:
            last_error = e
            if e.code not in RETRYABLE_STATUS or attempt == MAX_RETRIES - 1:
                raise
        except urllib.error.URLError as e:
            last_error = e
            if attempt == MAX_RETRIES - 1:
                raise
        time.sleep(BACKOFF_BASE * (2 ** attempt) + random.uniform(0, BACKOFF_BASE))

    if last_error:
        raise last_error
    return []


def _extract_json_object(text: str) -> dict:
    """Parse the first {...} JSON object out of a model response (tolerates code fences/prose)."""
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("no JSON object in judge response")
    return json.loads(text[start:end + 1])


def judge_relevance(query: str, candidates: list) -> dict:
    """Ask Bedrock which candidates are relevant; return {index_str: why_relevant}.

    Raises on any Bedrock or parsing failure so the caller can degrade open (unfiltered).
    """
    from aws_utils import bedrock_utils

    numbered = "\n".join(
        f"[{i}] {c.get('title', '')} — {c.get('snippet', '')} ({c.get('url', '')})"
        for i, c in enumerate(candidates)
    )
    prompt = (
        "You judge which web search results are relevant to a query.\n\n"
        f"Query: {query}\n\nResults:\n{numbered}\n\n"
        "Return ONLY a JSON object mapping the index (as a string) of each RELEVANT result to "
        "a one-sentence reason it is relevant. Omit irrelevant results. Example: "
        '{"0": "Directly discusses the subject.", "2": "Primary source for the claim."}'
    )
    text = bedrock_utils.converse_text(prompt, max_tokens=1024, temperature=0)
    verdicts = _extract_json_object(text)
    return {str(k): v for k, v in verdicts.items()}


def apply_judge(query: str, candidates: list) -> tuple:
    """Filter candidates to the relevant ones (attaching why_relevant). Degrade open on error."""
    try:
        verdicts = judge_relevance(query, candidates)
    except Exception as e:
        return candidates, str(e)

    filtered = []
    for i, candidate in enumerate(candidates):
        reason = verdicts.get(str(i))
        if reason:
            filtered.append({**candidate, "why_relevant": reason})
    return filtered, None


def main(query: str, llm_eval: bool = False) -> dict:
    """Search the web via Brave and return candidate results (optionally LLM-filtered)."""
    query = (query or "").strip()
    if not query:
        return {"error": "query is required"}

    brave_key = load_keys().get("BRAVE_API_KEY", "")
    if not brave_key:
        return {"error": "web_search not configured"}

    try:
        candidates = fetch_brave_with_retry(query, brave_key)
    except Exception as e:
        return {"error": f"web search failed: {e}", "query": query}

    result = {"query": query, "source": "brave", "llm_eval": bool(llm_eval)}

    if llm_eval and candidates:
        results, judge_error = apply_judge(query, candidates)
        result["results"] = results
        if judge_error:
            result["judge_error"] = judge_error
    else:
        result["results"] = candidates

    result["result_count"] = len(result["results"])
    return result


def _coerce_bool(value) -> bool:
    """Normalize a gateway/REST llm_eval value (bool or string) to a bool."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes")
    return bool(value)


def extract_args(event) -> tuple:
    """Read query + llm_eval from a gateway event (raw args) or a REST event (body/query)."""
    if isinstance(event.get("body"), str):
        try:
            body = json.loads(event["body"]) if event["body"] else {}
        except json.JSONDecodeError:
            body = {}
    else:
        body = event.get("body") or {}

    params = event.get("queryStringParameters") or {}
    query = event.get("query") or body.get("query") or params.get("query") or ""
    llm_eval = event.get("llm_eval")
    if llm_eval is None:
        llm_eval = body.get("llm_eval")
    if llm_eval is None:
        llm_eval = params.get("llm_eval")
    return query, _coerce_bool(llm_eval)


def lambda_handler(event, context):
    # AgentCore Gateway tool path: bare dict out (no statusCode/body envelope).
    if lambda_utils.is_gateway_invocation(event, context):
        return main(event.get("query", ""), _coerce_bool(event.get("llm_eval", False)))

    # REST API path: CORS preflight + {statusCode, body} envelope via aws_utils.
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        query, llm_eval = extract_args(event)
        return lambda_utils.success_response(main(query, llm_eval))
    except Exception as e:
        print(f"Error running web search: {str(e)}")
        return lambda_utils.server_error(str(e))
