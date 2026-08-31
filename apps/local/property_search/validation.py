"""
Filter validation for a search request.

Ported from the cloud API's create-search handler and kept strict even though the only
caller is the local SPA: every value here is interpolated into a URL the browser then
navigates to, so the safe alphabet and the range checks are doing real work regardless of
who is on the other end of the socket.
"""

import time

import store
from sources.property_guru import PROPERTY_TYPE_CODES_BY_GROUP, PROPERTY_TYPE_GROUPS

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
    "minSizeLand",
    "maxSizeLand",
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
    ("minSizeLand", "maxSizeLand"),
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


def build_filters(raw: dict, group: str) -> dict:
    """Validate and normalise one property type group's filter object.

    The group is checked against too, because a property type code belonging to another
    group returns zero results from the source rather than an error, and "nothing matched"
    is the one answer a broken filter and an honest one give alike.
    """
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

    group_codes = PROPERTY_TYPE_CODES_BY_GROUP.get(group) or ()
    for code in filters.get("propertyTypeCode") or []:
        if code not in group_codes:
            raise ValueError(f"propertyTypeCode {code} does not belong to group {group}")

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


def clean_max_pages(value) -> int:
    """Bound one group's page budget.

    An absent maxPages is one page, not every page: a caller that says nothing about the
    size of a scrape should not get the longest one there is.
    """
    pages = clean_int(value, "maxPages")
    if pages is None:
        return 1
    return min(pages, MAX_PAGES_CEILING) if pages else pages


def build_searches(body: dict) -> list:
    """Validate the per property type searches a request fans out into.

    One entry per property type group, each with its own page budget and its own complete
    filter set, because a single query cannot span two groups (see the source module) and
    because the panel lets each type be filtered on its own terms.

    A body with no `searches` and a flat `filters` is read as one non-landed search, which
    is what every request and every saved search written before the tabs existed is.
    """
    raw = body.get("searches")
    if raw is None:
        return [
            {
                "propertyTypeGroup": "N",
                "maxPages": clean_max_pages(body.get("maxPages")),
                "filters": build_filters(body.get("filters") or {}, "N"),
            }
        ]

    if not isinstance(raw, list):
        raise ValueError("searches must be a list")
    if not raw:
        raise ValueError("Pick at least one property type to search")

    searches = []
    seen = set()
    for entry in raw:
        if not isinstance(entry, dict):
            raise ValueError("each search must be an object")
        group = clean_choice(entry.get("propertyTypeGroup"), "", "propertyTypeGroup")
        if group not in PROPERTY_TYPE_GROUPS:
            options = ", ".join(PROPERTY_TYPE_GROUPS)
            raise ValueError(f"propertyTypeGroup must be one of {options}")
        # Repeats are refused rather than merged: two entries for one group would run the
        # same query twice and there is no honest way to pick which one's bounds apply.
        if group in seen:
            raise ValueError(f"propertyTypeGroup {group} appears more than once")
        seen.add(group)
        searches.append(
            {
                "propertyTypeGroup": group,
                "maxPages": clean_max_pages(entry.get("maxPages")),
                "filters": build_filters(entry.get("filters") or {}, group),
            }
        )
    return searches


def build_request(body: dict) -> tuple:
    """Validate a whole search body, returning (source, searches)."""
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object")

    source = clean_choice(body.get("source"), "propertyguru", "source")
    if source not in KNOWN_SOURCES:
        raise ValueError(f"source must be one of {', '.join(KNOWN_SOURCES)}")

    return source, build_searches(body)


def clean_entity_id(value) -> str:
    """Check the source's own id for one property or unit.

    Shared by everything that names an entity, so a hidden item, a bookmark and an
    always hidden item are all held to one rule rather than three copies of it.
    """
    if isinstance(value, bool) or not isinstance(value, (int, str, type(None))):
        raise ValueError("id must be a string or a number")
    entity_id = str(value or "").strip()
    if not entity_id:
        raise ValueError("id is required")
    if len(entity_id) > 100:
        raise ValueError("id is too long")
    return entity_id


def clean_entity_scope(scope) -> str:
    """Check a scope, which is the half of an entity key that says what the id names."""
    if scope not in ("property", "unit"):
        raise ValueError("scope must be property or unit")
    return scope


def clean_hidden(item: dict) -> tuple:
    """Validate one hidden property or unit, returning (scope, id, label)."""
    if not isinstance(item, dict):
        raise ValueError("each hidden item must be an object")

    scope = clean_entity_scope(item.get("scope"))
    entity_id = clean_entity_id(item.get("id"))

    label = item.get("label")
    if label is not None and not isinstance(label, str):
        raise ValueError("label must be a string")

    return scope, entity_id, (label or "")[:200]


def clean_bookmark(item: dict) -> tuple:
    """Validate one bookmarked property, returning (id, label).

    Bookmarks are properties only, because a bookmark pins a card to the top of the
    results and a unit has no card of its own to pin.
    """
    if not isinstance(item, dict):
        raise ValueError("each bookmarked item must be an object")

    if item.get("scope") not in (None, "property"):
        raise ValueError("bookmarks are properties only")

    entity_id = clean_entity_id(item.get("id"))

    label = item.get("label")
    if label is not None and not isinstance(label, str):
        raise ValueError("label must be a string")

    return entity_id, (label or "")[:200]


SAVED_SEARCH_NAME_MAX_CHARS = 80
SEARCH_ID_MAX_CHARS = 64
# Hiding is per search, so the list is bounded per search too. Far more than anyone
# hides by hand, and low enough that a saved search stays a small row.
MAX_HIDDEN_PER_SEARCH = 500
# Bookmarks are bounded lower than hidden items, because the pinned block sits at the
# top of the results and stops being useful once it stops being scannable.
MAX_BOOKMARKED_PER_SEARCH = 200


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


def clean_bookmarked_list(raw) -> list:
    """Validate a search's bookmarked properties, returning them newest first.

    The mirror of clean_hidden_list: the key and the timestamp are rebuilt here rather
    than trusted, and a repeated key keeps its first appearance.
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("bookmarked must be a list")
    if len(raw) > MAX_BOOKMARKED_PER_SEARCH:
        raise ValueError(
            f"A search can bookmark at most {MAX_BOOKMARKED_PER_SEARCH} properties"
        )

    now = int(time.time())
    cleaned = {}
    for item in raw:
        entity_id, label = clean_bookmark(item)
        entity_key = f"property#{entity_id}"
        if entity_key in cleaned:
            continue
        created_at = clean_int(item.get("createdAt"), "createdAt")
        cleaned[entity_key] = {
            "entityKey": entity_key,
            "scope": "property",
            "id": entity_id,
            "label": label,
            "createdAt": created_at if created_at is not None else now,
        }
    return sorted(cleaned.values(), key=lambda item: item["createdAt"], reverse=True)


def clean_saved_search(body: dict) -> tuple:
    """Validate a save request.

    Returns (name, source, searches, hidden, bookmarked).

    The request half goes through build_request, so a saved search is held to exactly
    the same rules as the search it came from and there is no second filter validator
    to keep in step with the first.
    """
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object")

    name = clean_text(body.get("name"), "name", SAVED_SEARCH_NAME_MAX_CHARS)
    if not name:
        raise ValueError("name is required")

    source, searches = build_request(body.get("request") or {})
    return (
        name,
        source,
        searches,
        clean_hidden_list(body.get("hidden")),
        clean_bookmarked_list(body.get("bookmarked")),
    )


def clean_hidden_update(body: dict) -> list:
    """Validate a request that carries a saved search's hidden list on its own."""
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object")
    return clean_hidden_list(body.get("hidden"))


def clean_bookmarked_update(body: dict) -> list:
    """Validate a request that carries a saved search's bookmarked list on its own."""
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object")
    return clean_bookmarked_list(body.get("bookmarked"))


def clean_always_hidden(body: dict) -> dict:
    """Validate one always hidden property or unit, returning the record to store.

    The same rules a search's own hidden list goes through, one item at a time, because
    this list is written a hide at a time rather than replaced wholesale.
    """
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object")

    scope, entity_id, label = clean_hidden(body)
    created_at = clean_int(body.get("createdAt"), "createdAt")
    return {
        "entityKey": f"{scope}#{entity_id}",
        "scope": scope,
        "id": entity_id,
        "label": label,
        "createdAt": created_at if created_at is not None else int(time.time()),
    }


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


def clean_optional_search_id(search_id: str) -> str:
    """The same check for a search id a request may leave out entirely.

    Kept apart from build_request because clean_saved_search validates a stored search
    through it, and a saved search must not end up carrying an id of its own inside the
    request it replays.
    """
    if search_id is None or not str(search_id).strip():
        return None
    return clean_search_id(search_id)


LISTING_ID_MAX_CHARS = 64
PROPERTY_ID_MAX_CHARS = 100
MAX_FLOORPLANS = 20
# Far higher than the floorplan cap, because a listing carries photos in a different
# order of quantity: 36 was the most on any one card during the discovery capture.
MAX_PHOTOS = 60
# The project's own gallery, which is a different set from the listing photos above and
# is capped separately. Nine on the project probed during the spike, and the same ceiling
# is plenty of headroom for a development that shows off more of itself.
MAX_PROPERTY_PHOTOS = 60


def clean_url(value, field: str, max_chars: int = 500) -> str:
    """Coerce one URL to a trimmed http or https string, or '' when absent.

    The scheme check is the point. These strings are stored and later rendered as an
    href or an image source without a scrape in between, so a javascript: or data: value
    accepted here would be one the page then hands to the browser.
    """
    if value in (None, ""):
        return ""
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    # A URL carries no whitespace, so any that arrived is paste damage or padding.
    text = "".join(value.split())
    if len(text) > max_chars:
        raise ValueError(f"{field} is too long")
    if not text.startswith(("http://", "https://")):
        raise ValueError(f"{field} must be an http or https URL")
    return text


def clean_url_list(values, field: str, max_items: int) -> list:
    """Coerce one repeatable URL field to a list, dropping the empties."""
    if not values:
        return []
    if not isinstance(values, list):
        raise ValueError(f"{field} must be a list")
    if len(values) > max_items:
        raise ValueError(f"{field} has too many values")
    return [url for url in (clean_url(value, field) for value in values) if url]


def clean_listing_id(listing_id) -> str:
    """Check a listing id, which is the source's own id for one unit.

    It is the shortlist's key and it comes straight back to the SPA, so it is held to
    the same safe alphabet clean_search_id holds a saved search id to.
    """
    if isinstance(listing_id, bool) or not isinstance(listing_id, (int, str, type(None))):
        raise ValueError("listingId must be a string or a number")
    text = str(listing_id if listing_id is not None else "").strip()
    if not text:
        raise ValueError("listingId is required")
    if len(text) > LISTING_ID_MAX_CHARS:
        raise ValueError("listingId is too long")
    if not text.replace("-", "").replace("_", "").isalnum():
        raise ValueError("listingId contains an invalid character")
    return text


def clean_property_info(raw) -> dict:
    """Rebuild the project facts block that rides along with a shortlisted unit.

    Absent facts stay None rather than becoming 0, which is the same distinction
    grouping._build_property draws: the UI shows a fallback for a missing year, and a
    zero would read as real data.
    """
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ValueError("info must be an object")

    enrichment = clean_choice(raw.get("enrichment"), "unavailable", "enrichment")
    if enrichment not in ("ok", "unavailable"):
        raise ValueError("enrichment must be ok or unavailable")

    photos = clean_url_list(raw.get("photos"), "photos", MAX_PROPERTY_PHOTOS)

    return {
        "district": clean_text(raw.get("district"), "district", 40),
        "districtName": clean_text(raw.get("districtName"), "districtName", 100),
        "regionName": clean_text(raw.get("regionName"), "regionName", 100),
        "address": clean_text(raw.get("address"), "address", 300),
        "topYear": clean_int(raw.get("topYear"), "topYear"),
        "totalUnits": clean_int(raw.get("totalUnits"), "totalUnits"),
        "floors": clean_int(raw.get("floors"), "floors"),
        "tenure": clean_text(raw.get("tenure"), "tenure", 100),
        "developer": clean_text(raw.get("developer"), "developer", 200),
        "propertyType": clean_text(raw.get("propertyType"), "propertyType", 100),
        "psfRange": clean_text(raw.get("psfRange"), "psfRange", 100),
        "projectUrl": clean_url(raw.get("projectUrl"), "projectUrl"),
        "imageUrl": clean_url(raw.get("imageUrl"), "imageUrl"),
        # The gallery is stored whole here rather than as a count, because a shortlist
        # outlives the cache row the carousel would otherwise fetch from. The count is
        # derived from the list that survived cleaning, so a snapshot cannot advertise
        # photos it does not carry.
        "photos": photos,
        "photoCount": len(photos),
        "enrichment": enrichment,
    }


def clean_shortlist(body: dict) -> dict:
    """Validate a shortlisted unit, returning the flat listing record to store.

    The record is rebuilt field by field rather than passed through, which matters more
    here than anywhere else in this module: a shortlist is read back and rendered
    without a scrape in between, so this is the only gate between the request body and
    the page.

    The shape is a flat listing on purpose. It is what grouping._build_unit_types
    already consumes, so reading the shortlist back regroups it through the same helpers
    a search result goes through, with no second grouping implementation to keep in step.
    """
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object")

    property_id = body.get("propertyId")
    if isinstance(property_id, int) and not isinstance(property_id, bool):
        property_id = str(property_id)
    property_id = clean_text(property_id, "propertyId", PROPERTY_ID_MAX_CHARS)
    if not property_id:
        raise ValueError("propertyId is required")

    return {
        "listingId": clean_listing_id(body.get("listingId")),
        "propertyId": property_id,
        "propertyName": clean_text(body.get("propertyName"), "propertyName", 200),
        "info": clean_property_info(body.get("info")),
        "bedrooms": clean_int(body.get("bedrooms"), "bedrooms"),
        "price": clean_int(body.get("price"), "price"),
        "bathrooms": clean_int(body.get("bathrooms"), "bathrooms"),
        "floorAreaSqft": clean_int(body.get("floorAreaSqft"), "floorAreaSqft"),
        "psf": clean_int(body.get("psf"), "psf"),
        "url": clean_url(body.get("url"), "url"),
        "listedAt": clean_int(body.get("listedAt"), "listedAt"),
        "listedLabel": clean_text(body.get("listedLabel"), "listedLabel", 100),
        "agentName": clean_text(body.get("agentName"), "agentName", 200),
        "agencyName": clean_text(body.get("agencyName"), "agencyName", 200),
        "floorplans": clean_url_list(body.get("floorplans"), "floorplans", MAX_FLOORPLANS),
        "photos": clean_url_list(body.get("photos"), "photos", MAX_PHOTOS),
    }


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


def clean_scrape_mode(body: dict) -> str:
    """Validate a scrape mode save. Unlike the token above there is no empty case.

    A scrape has to run on something, so unsetting the mode means picking the other one
    rather than sending nothing.
    """
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object")

    mode = body.get("mode")
    if mode not in store.SCRAPE_MODES:
        raise ValueError(f"mode must be one of: {', '.join(store.SCRAPE_MODES)}")
    return mode
