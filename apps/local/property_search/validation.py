"""
Filter validation for a search request.

Ported from the cloud API's create-search handler and kept strict even though the only
caller is the local SPA: every value here is interpolated into a URL the browser then
navigates to, so the safe alphabet and the range checks are doing real work regardless of
who is on the other end of the socket.
"""

import time

KNOWN_SOURCES = ("propertyguru",)
# The ceiling bounds an explicit page count only. A maxPages of 0 is the "every page"
# sentinel and deliberately passes through unclamped.
MAX_PAGES_CEILING = 10

# Only these filter keys reach the source adapter. Anything else a caller sends is
# dropped rather than passed through into a scraper URL.
INT_FILTERS = (
    "minPrice",
    "maxPrice",
    "minSize",
    "maxSize",
    "minTop",
    "maxTop",
    "minPsf",
    "maxPsf",
    "lastPosted",
)
LIST_FILTERS = (
    "bedrooms",
    "bathrooms",
    "propertyTypeCode",
    "districtCode",
    "tenureCode",
    "floorLevel",
    "furnishing",
    "unitFeatures",
    "projectFeatures",
)
FLAG_FILTERS = ("isVerified", "withFloorplans", "withStream")
# Every min/max pair the source understands, checked the same way.
RANGE_FILTERS = (
    ("minPrice", "maxPrice"),
    ("minSize", "maxSize"),
    ("minTop", "maxTop"),
    ("minPsf", "maxPsf"),
)
SORT_VALUES = ("date", "price", "psf", "size")
ORDER_VALUES = ("asc", "desc")
# Not an int filter: PropertyGuru's distances are fractions of a kilometre.
DISTANCE_TO_MRT_VALUES = ("0.25", "0.5", "0.75", "1", "1.5")
KEYWORD_MAX_CHARS = 100


def clean_int(value, field):
    """Coerce one scalar filter to a non-negative int, or None when absent."""
    if value in (None, ""):
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError(f"{field} must be a number")
    try:
        # OverflowError covers a JSON literal like 1e400, which Python parses as inf.
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        raise ValueError(f"{field} must be a number")
    if parsed < 0:
        raise ValueError(f"{field} must not be negative")
    return parsed


def clean_list(values, field):
    """Coerce one repeatable filter to a list of plain scalars, capped in length."""
    if not values:
        return []
    if not isinstance(values, list):
        raise ValueError(f"{field} must be a list")
    if len(values) > 30:
        raise ValueError(f"{field} has too many values")

    cleaned = []
    for value in values:
        if isinstance(value, bool) or not isinstance(value, (int, str)):
            raise ValueError(f"{field} values must be numbers or strings")
        text = str(value).strip()
        # Values are interpolated into a query string, so keep them to a safe alphabet.
        if not text or not text.replace("_", "").isalnum():
            raise ValueError(f"{field} contains an invalid value")
        cleaned.append(text)
    return cleaned


def clean_choice(value, default: str, field: str) -> str:
    """Coerce one enum-ish filter to a string, rejecting non-string JSON outright."""
    if value in (None, ""):
        return default
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    return value.strip()


def clean_flag(value, field) -> bool:
    """Coerce one on/off filter to a bool, treating an absent value as off."""
    if value in (None, ""):
        return False
    if not isinstance(value, bool):
        raise ValueError(f"{field} must be true or false")
    return value


def clean_text(value, field: str, max_chars: int) -> str:
    """Coerce one free text filter to a single trimmed line, or '' when absent."""
    if value in (None, ""):
        return ""
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    # Collapsing on split() also drops the newlines and tabs that would otherwise ride
    # into the query string.
    text = " ".join(value.split())
    if len(text) > max_chars:
        raise ValueError(f"{field} must be {max_chars} characters or fewer")
    return text


def build_filters(raw: dict) -> dict:
    """Validate and normalise the caller's filter object."""
    if not isinstance(raw, dict):
        raise ValueError("filters must be an object")

    filters = {}
    for field in INT_FILTERS:
        value = clean_int(raw.get(field), field)
        if value is not None:
            filters[field] = value

    for field in LIST_FILTERS:
        values = clean_list(raw.get(field), field)
        if values:
            filters[field] = values

    for field in FLAG_FILTERS:
        if clean_flag(raw.get(field), field):
            filters[field] = True

    keyword = clean_text(raw.get("keyword"), "keyword", KEYWORD_MAX_CHARS)
    if keyword:
        filters["keyword"] = keyword

    distance = clean_choice(raw.get("distanceToMrt"), "", "distanceToMrt")
    if distance:
        if distance not in DISTANCE_TO_MRT_VALUES:
            options = ", ".join(DISTANCE_TO_MRT_VALUES)
            raise ValueError(f"distanceToMrt must be one of {options}")
        filters["distanceToMrt"] = distance

    # `is not None`, not truthiness: a 0 bound is a real value, and skipping the check
    # would accept an impossible range like minPrice 500000 with maxPrice 0.
    for low, high in RANGE_FILTERS:
        if filters.get(low) is not None and filters.get(high) is not None:
            if filters[low] > filters[high]:
                raise ValueError(f"{low} must not exceed {high}")

    sort = clean_choice(raw.get("sort"), "date", "sort")
    order = clean_choice(raw.get("order"), "desc", "order")
    if sort not in SORT_VALUES:
        raise ValueError(f"sort must be one of {', '.join(SORT_VALUES)}")
    if order not in ORDER_VALUES:
        raise ValueError(f"order must be one of {', '.join(ORDER_VALUES)}")
    filters["sort"] = sort
    filters["order"] = order

    return filters


def build_request(body: dict) -> tuple:
    """Validate a whole search body, returning (source, maxPages, filters)."""
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object")

    source = clean_choice(body.get("source"), "propertyguru", "source")
    if source not in KNOWN_SOURCES:
        raise ValueError(f"source must be one of {', '.join(KNOWN_SOURCES)}")

    # An absent maxPages is one page, not every page: a caller that says nothing about
    # the size of a scrape should not get the longest one there is.
    pages = clean_int(body.get("maxPages"), "maxPages")
    if pages is None:
        pages = 1
    elif pages:
        pages = min(pages, MAX_PAGES_CEILING)

    return source, pages, build_filters(body.get("filters") or {})


def clean_hidden(item: dict) -> tuple:
    """Validate one hidden property or unit, returning (scope, id, label)."""
    if not isinstance(item, dict):
        raise ValueError("each hidden item must be an object")

    scope = item.get("scope")
    if scope not in ("property", "unit"):
        raise ValueError("scope must be property or unit")

    entity_id = item.get("id")
    if isinstance(entity_id, bool) or not isinstance(entity_id, (int, str, type(None))):
        raise ValueError("id must be a string or a number")
    entity_id = str(entity_id or "").strip()
    if not entity_id:
        raise ValueError("id is required")
    if len(entity_id) > 100:
        raise ValueError("id is too long")

    label = item.get("label")
    if label is not None and not isinstance(label, str):
        raise ValueError("label must be a string")

    return scope, entity_id, (label or "")[:200]


SAVED_SEARCH_NAME_MAX_CHARS = 80
SEARCH_ID_MAX_CHARS = 64
# Hiding is per search, so the list is bounded per search too. Far more than anyone
# hides by hand, and low enough that a saved search stays a small row.
MAX_HIDDEN_PER_SEARCH = 500


def clean_hidden_list(raw) -> list:
    """Validate a search's hidden items, returning the stored entities newest first.

    Each item goes through clean_hidden, so a hidden entry written by a save, an edit or
    a single hide is held to one set of rules. The key and the timestamp are rebuilt here
    rather than trusted, and a repeated key keeps its first appearance.
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("hidden must be a list")
    if len(raw) > MAX_HIDDEN_PER_SEARCH:
        raise ValueError(f"A search can hide at most {MAX_HIDDEN_PER_SEARCH} items")

    now = int(time.time())
    cleaned = {}
    for item in raw:
        scope, entity_id, label = clean_hidden(item)
        entity_key = f"{scope}#{entity_id}"
        if entity_key in cleaned:
            continue
        created_at = clean_int(item.get("createdAt"), "createdAt")
        cleaned[entity_key] = {
            "entityKey": entity_key,
            "scope": scope,
            "id": entity_id,
            "label": label,
            "createdAt": created_at if created_at is not None else now,
        }
    return sorted(cleaned.values(), key=lambda item: item["createdAt"], reverse=True)


def clean_saved_search(body: dict) -> tuple:
    """Validate a save request, returning (name, source, maxPages, filters, hidden).

    The request half goes through build_request, so a saved search is held to exactly
    the same rules as the search it came from and there is no second filter validator
    to keep in step with the first.
    """
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object")

    name = clean_text(body.get("name"), "name", SAVED_SEARCH_NAME_MAX_CHARS)
    if not name:
        raise ValueError("name is required")

    source, pages, filters = build_request(body.get("request") or {})
    return name, source, pages, filters, clean_hidden_list(body.get("hidden"))


def clean_hidden_update(body: dict) -> list:
    """Validate a request that carries a saved search's hidden list on its own."""
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object")
    return clean_hidden_list(body.get("hidden"))


def clean_search_id(search_id: str) -> str:
    """Check a saved search id, which is a uuid4 this server minted."""
    search_id = (search_id or "").strip()
    if not search_id:
        raise ValueError("searchId is required")
    if len(search_id) > SEARCH_ID_MAX_CHARS:
        raise ValueError("searchId is too long")
    if not search_id.replace("-", "").isalnum():
        raise ValueError("searchId contains an invalid character")
    return search_id


# The page context is a rendered description of one screen, so it is bounded rather
# than unbounded: a result set of a hundred properties with their unit tables is a
# few tens of kilobytes, and anything past this is not a page.
MAX_PAGE_CONTEXT = 200_000
MAX_PROMPT = 20_000
MAX_TOKEN = 500


def clean_action(raw) -> dict:
    """Reduce one action definition to the four fields the prompt actually uses.

    The browser sends `display` and `callback` nowhere near this, but the metadata it
    does send is interpolated into the prompt, so it is rebuilt field by field rather
    than passed through.
    """
    if not isinstance(raw, dict):
        raise ValueError("each action must be an object")

    name = clean_text(raw.get("name"), "action name", 100)
    if not name:
        raise ValueError("each action must have a name")

    parameters = raw.get("parameters") or {}
    if not isinstance(parameters, dict):
        raise ValueError("action parameters must be an object")

    return {
        "name": name,
        "description": clean_text(raw.get("description"), "action description", 1000),
        "parameters": {
            str(key): clean_text(value, "action parameter", 500)
            for key, value in parameters.items()
        },
        "example": clean_text(raw.get("example"), "action example", 500),
    }


def build_chat_request(body: dict) -> tuple:
    """Validate a chat turn, returning (sessionId, prompt, pageContext, actions)."""
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object")

    prompt = body.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("prompt is required")
    if len(prompt) > MAX_PROMPT:
        raise ValueError(f"prompt must be {MAX_PROMPT} characters or fewer")

    session_id = clean_text(body.get("sessionId"), "sessionId", 100)
    if not session_id:
        raise ValueError("sessionId is required")

    page_context = body.get("pageContext") or ""
    if not isinstance(page_context, str):
        raise ValueError("pageContext must be a string")
    if len(page_context) > MAX_PAGE_CONTEXT:
        raise ValueError("pageContext is too large")

    raw_actions = body.get("actions") or []
    if not isinstance(raw_actions, list):
        raise ValueError("actions must be a list")

    return session_id, prompt.strip(), page_context, [clean_action(a) for a in raw_actions]


def clean_token(body: dict) -> str:
    """Validate a Claude token save. An empty string is a removal, not an error."""
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object")

    token = body.get("token")
    if token is None:
        token = ""
    if not isinstance(token, str):
        raise ValueError("token must be a string")

    # Whitespace in a pasted token is paste damage from a wrapped terminal line,
    # never part of the value.
    token = "".join(token.split())
    if len(token) > MAX_TOKEN:
        raise ValueError("token is too long")
    return token
