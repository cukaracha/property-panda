"""
PropertyGuru source adapter.

Field provenance (recorded from a live capture during the discovery spike, because the
site 403s any non-browser client and the shapes below cannot be re-derived from docs):

Search results page
    Data lives in the `__NEXT_DATA__` script tag, NOT in the `{"productData":` blobs the
    original Streamlit prototype split on -- that marker no longer appears in the markup
    at all, which is why the old parser returns nothing today.
      props.pageProps.pageData.data.listingsData[]  -- 25 cards per page
        [].listingData          -> id, price{value}, bedrooms, bathrooms, floorArea (int
                                   sqft), url, fullAddress, postedOn{text,unix},
                                   pricePerArea, localizedTitle, agent{name}, agency{name},
                                   property{id} (the project id)
        [].segment.parameters.metaData.listingData
                                -> district, districtName, regionName, tenure, projectId,
                                   propertyType, property{developerName}
      props.pageProps.pageData.data.paginationData.totalPages -- lets the worker stop early
    Note `listingData.developer` holds the *agent's* name, not the developer. The real
    developer is property.developerName on the segment metadata. Do not swap these.

Project page (https://www.propertyguru.com.sg/project/{slug}-{projectId})
    A different, newer app: no `__NEXT_DATA__`. The property facts sit in a microdata
    table of `<tr class="property-attr">` rows, label in `td.label-block`, value in
    `td.value-block`. Observed labels: Project Name, project type, Developer, Tenure,
    PSF, Completion Year, # of Floors, Total Units. The hero image is `og:image`.
"""

import html as html_lib
import json
import re
from urllib.parse import urlencode

BASE_URL = "https://www.propertyguru.com.sg"

# Search filter keys are camelCase now (the prototype's beds[0]/maxprice/mintop form is
# the legacy one). Repeatable keys are emitted once per value, doseq-style.
#
# Both the key names and the values they accept come from the search page's own
# __NEXT_DATA__: `searchFilterData.filters[]` names the input per filter and
# `searchFilterData.filterValues` lists its options. Read them from there rather than
# guessing, because a key the site does not recognise is dropped in silence and the
# search comes back unfiltered -- which reads as a very broad search, not as a bug.
# `minCompletionYear`/`maxCompletionYear` were exactly that: the build year inputs are
# `minTopYear`/`maxTopYear`.
_LIST_PARAMS = {
    "bedrooms": "bedrooms",
    "bathrooms": "bathrooms",
    "propertyTypeCode": "propertyTypeCode",
    "districtCode": "districtCode",
    "tenureCode": "tenureCode",
    "floorLevel": "floorLevel",
    "furnishing": "furnishing",
    "unitFeatures": "unitFeatures",
    "projectFeatures": "projectFeatures",
}
_SCALAR_PARAMS = {
    "minPrice": "minPrice",
    "maxPrice": "maxPrice",
    "minSize": "minSize",
    "maxSize": "maxSize",
    "minTop": "minTopYear",
    "maxTop": "maxTopYear",
    "minPsf": "minPricePerArea",
    "maxPsf": "maxPricePerArea",
    "distanceToMrt": "distanceToMRT",
    "keyword": "keyword",
    "lastPosted": "lastPosted",
}
# On/off filters: the site reads the presence of the key, so an unset one is left out
# entirely rather than sent as "false".
_FLAG_PARAMS = {
    "isVerified": "isVerified",
    "withFloorplans": "withFloorplans",
    "withStream": "withStream",
}

_NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json"[^>]*>(.*?)</script>', re.S
)
_ATTR_ROW_RE = re.compile(
    r'<tr class="property-attr[^"]*">\s*'
    r'<td class="label-block"[^>]*>\s*(?:<h4[^>]*>)?(.*?)(?:</h4>)?\s*</td>\s*'
    r'<td class="value-block"[^>]*>(.*?)</td>',
    re.S,
)
_OG_IMAGE_RE = re.compile(r'<meta property="og:image" content="([^"]+)"')
_TAG_RE = re.compile(r"<[^>]*>")


class PropertyGuruSource:
    """Reads for-sale residential listings from PropertyGuru."""

    name = "propertyguru"

    # ---------------------------------------------------------------- search

    def build_search_url(self, filters: dict, page: int) -> str:
        """Build one search-results page URL from the normalised filter dict."""
        params = [("propertyTypeGroup", "N"), ("page", str(page))]

        for key, param in _SCALAR_PARAMS.items():
            value = filters.get(key)
            if value not in (None, ""):
                params.append((param, str(value)))

        for key, param in _LIST_PARAMS.items():
            for value in filters.get(key) or []:
                params.append((param, str(value)))

        for key, param in _FLAG_PARAMS.items():
            if filters.get(key):
                params.append((param, "true"))

        params.append(("sort", filters.get("sort") or "date"))
        params.append(("order", filters.get("order") or "desc"))

        return f"{BASE_URL}/property-for-sale/{page}?{urlencode(params)}"

    def parse_listings(self, html: str) -> list:
        """Return one normalised record per listing card on a search-results page."""
        data = self._next_data(html)
        if not data:
            return []

        cards = (
            data.get("props", {})
            .get("pageProps", {})
            .get("pageData", {})
            .get("data", {})
            .get("listingsData")
            or []
        )

        listings = []
        for card in cards:
            try:
                record = self._parse_card(card)
            except Exception as e:
                # Skip the bad card rather than failing the job. Enrichment is already
                # best effort; card parsing should degrade the same way.
                print(f"Skipping unparseable listing card: {e}")
                continue
            if record:
                listings.append(record)
        return listings

    def total_pages(self, html: str) -> int:
        """Read the search's page count so the worker never walks past the last page."""
        data = self._next_data(html)
        if not data:
            return 0
        pagination = (
            data.get("props", {})
            .get("pageProps", {})
            .get("pageData", {})
            .get("data", {})
            .get("paginationData")
            or {}
        )
        try:
            return int(pagination.get("totalPages") or 0)
        except (TypeError, ValueError):
            return 0

    def _parse_card(self, card: dict) -> dict:
        """Flatten one listingsData entry, or return {} when it is not a usable listing."""
        listing = card.get("listingData") or {}
        meta = (
            card.get("segment", {})
            .get("parameters", {})
            .get("metaData", {})
            .get("listingData")
            or {}
        )

        listing_id = listing.get("id") or meta.get("listingId")
        price = self._as_int((listing.get("price") or {}).get("value") or meta.get("price"))
        if not listing_id or not price:
            return {}

        floor_area = self._as_int(listing.get("floorArea") or meta.get("floorArea"))
        bedrooms = self._as_int(listing.get("bedrooms") or meta.get("bedroom"))

        project_id = (listing.get("property") or {}).get("id") or meta.get("projectId")
        posted = listing.get("postedOn") or {}

        return {
            "listingId": int(listing_id),
            "propertyId": str(project_id) if project_id else "",
            "name": listing.get("localizedTitle") or meta.get("listingTitle") or "",
            "price": price,
            "bedrooms": bedrooms,
            "bathrooms": self._as_int(listing.get("bathrooms") or meta.get("bathroom")),
            "floorAreaSqft": floor_area,
            # Derived rather than parsed out of psfText: the site formats that string for
            # display ("S$ 1,161.55 psf") and it is absent on some cards.
            "psf": round(price / floor_area) if price and floor_area else None,
            "url": listing.get("url") or "",
            "address": listing.get("fullAddress") or "",
            "listedAt": self._as_int(posted.get("unix")),
            "listedLabel": posted.get("text") or "",
            "agentName": (listing.get("agent") or {}).get("name") or "",
            "agencyName": (listing.get("agency") or {}).get("name") or "",
            "district": meta.get("district") or "",
            "districtName": meta.get("districtName") or "",
            "regionName": meta.get("regionName") or "",
            "tenureCode": meta.get("tenure") or "",
            "propertyType": meta.get("propertyType") or "",
            "developer": (meta.get("property") or {}).get("developerName") or "",
        }

    # --------------------------------------------------------------- project

    def project_url(self, listing: dict) -> str:
        """Build the project page URL from the listing's name and project id."""
        project_id = str(listing.get("propertyId") or "")
        name = listing.get("name")
        # The id comes from scraped input and is interpolated into a URL the browser then
        # navigates to. Anything but digits could smuggle in userinfo ("1@evil.example/x")
        # and send the session to another host, so refuse rather than sanitise.
        if not re.fullmatch(r"\d+", project_id) or not name:
            return ""
        return f"{BASE_URL}/project/{self._slugify(name)}-{project_id}"

    def parse_project(self, html: str) -> dict:
        """Return the property-level facts from a project page's microdata table."""
        attrs = {}
        for raw_label, raw_value in _ATTR_ROW_RE.findall(html):
            label = self._text(raw_label).lower()
            value = self._text(raw_value)
            if label and value:
                attrs[label] = value

        image_match = _OG_IMAGE_RE.search(html)

        return {
            "topYear": self._as_int(attrs.get("completion year")),
            "totalUnits": self._as_int(attrs.get("total units")),
            "floors": self._as_int(attrs.get("# of floors")),
            "tenure": attrs.get("tenure") or "",
            "developer": attrs.get("developer") or "",
            "propertyType": attrs.get("project type") or "",
            "psfRange": attrs.get("psf") or "",
            "imageUrl": image_match.group(1) if image_match else "",
        }

    # ---------------------------------------------------------------- helpers

    @staticmethod
    def _next_data(html: str):
        """Decode the __NEXT_DATA__ payload, or None when the page did not render it."""
        match = _NEXT_DATA_RE.search(html or "")
        if not match:
            return None
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            return None

    @staticmethod
    def _text(raw: str) -> str:
        """Strip tags and unescape entities from one microdata cell."""
        return html_lib.unescape(_TAG_RE.sub("", raw or "")).strip()

    @staticmethod
    def _as_int(value):
        """Coerce '1,238' / '2004' / 1238 / 1238.0 to an int, or None if there is no number.

        Floats must be handled before any digit-stripping fallback: stripping non-digits
        from "1250000.0" yields "12500000", silently reporting a price as ten times its
        real value. Matching a signed decimal keeps the magnitude (and the sign) intact.
        """
        if value is None or value == "":
            return None
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return round(value)

        match = re.search(r"-?\d[\d,]*(?:\.\d+)?", str(value))
        if not match:
            return None
        return round(float(match.group(0).replace(",", "")))

    @staticmethod
    def _slugify(name: str) -> str:
        """Lowercase, alphanumerics kept, runs of anything else collapsed to one dash."""
        slug = re.sub(r"[^a-z0-9]+", "-", (name or "").lower())
        return slug.strip("-")
