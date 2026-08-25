"""
PropertyGuru source adapter.

Field provenance (recorded from a live capture during the discovery spike, because the
site 403s any non-browser client and the shapes below cannot be re-derived from docs):

Search results page
    Data lives in the `__NEXT_DATA__` script tag, NOT in the `{"productData":` blobs the
    original Streamlit prototype split on -- that marker no longer appears in the markup
    at all, which is why the old parser returns nothing today.
      props.pageProps.pageData.data.listingsData[]  -- 25 cards per page, of which only
                                   20 are search hits: the other 5 are ad slots sold by
                                   position (observed at 2, 7, 13, 19 and 25). See
                                   `_is_promoted_ad`.
        [].listingData          -> id, price{value}, bedrooms, bathrooms, floorArea (int
                                   sqft), url, fullAddress, postedOn{text,unix},
                                   pricePerArea, localizedTitle, agent{name}, agency{name},
                                   property{id} (the project id), products{} (what the
                                   agent paid for, plus the ad markers),
                                   mediaCarousel.previewMedia.floorPlans.items[]{caption,src}
                                   -- the listing's own floorplan images, already on the
                                   search page, so no project-page fetch is needed for them.
                                   `caption` repeats one SEO string across every item in a
                                   listing, so it cannot tell two plans apart and is dropped.
                                   mediaCarousel.previewMedia.images.items[]{caption,src}
                                   -- the listing's photos, in the same place and read the
                                   same way. Despite the name, `previewMedia` is not a
                                   truncated set: each card also carries mediaItems[] with
                                   the site's own displayed count ({"mediaType": "images",
                                   "text": "36"}), and that matched len(items) on 20 of 20
                                   organic cards over a 3-36 range, with no cap and no
                                   clustering at the top. The listing's own detail page is
                                   the worse source and is deliberately not read: it is a
                                   different app that server-renders only about ten of the
                                   ids for a gallery it lazy loads, and reaching it would
                                   cost a real navigation rather than the cheap in-page
                                   fetch a search page already gets.
        [].segment.parameters.metaData.listingData
                                -> district, districtName, regionName, tenure, projectId,
                                   propertyType, property{developerName}, adProduct
      props.pageProps.pageData.data.paginationData.totalPages -- lets the worker stop early
    Note `listingData.developer` holds the *agent's* name, not the developer. The real
    developer is property.developerName on the segment metadata. Do not swap these.

Project page (https://www.propertyguru.com.sg/project/{slug}-{projectId})
    A different, newer app: no `__NEXT_DATA__`. The property facts sit in a microdata
    table of `<tr class="property-attr">` rows, label in `td.label-block`, value in
    `td.value-block`. Observed labels: Project Name, project type, Developer, Tenure,
    PSF, Completion Year, # of Floors, Total Units. The hero image is `og:image`.

    The project's own photo gallery is server-rendered into the same markup:
      <div class="carousel-major"> ... <span class="gallery-item image"><img ...>
    Nine items on the probed project, and the page's own counter
    (`<a class="carousel-link-img">9 ...<em class="sr-only">Photos</em></a>`) matched all
    nine -- the same cross-check the listing photos get against `mediaItems`. The first
    three carry the URL in `src`; the rest carry a placeholder there and the real URL in
    `data-original` (repeated once more in `content`), so nothing is lazily fetched over
    the network and the whole set is readable from the one page load enrichment already
    makes. `og:image` is gallery photo #1, which is what lets the card's thumbnail open
    the carousel on the very image that was clicked. `alt` is the project name and an
    index on every image, so it cannot caption anything, exactly as on the listing side.

    These are the *project's* photos. They are a different set from the listing photos
    above -- one is the development, the other is the unit someone is selling -- and are
    stored and served apart from them rather than merged.

    This page is also the only place the project's coordinates appear, and it carries
    them three times over:
      <meta property="place:location:latitude|longitude" content="...">
      <meta itemprop="latitude|longitude" content="...">     (schema.org/GeoCoordinates)
      <div id="map-canvas" data-latitude="..." data-longitude="...">
    Two of the three are read below, so one being dropped upstream cannot silently zero
    the feature. Note the meta tags appear a second time inside an escaped JSON payload
    further down the page; matching the literal `" content="` form keeps the parse on the
    real markup.

    Coordinates are NOT on the search results page. All 19,476 scalar fields of
    `pageData.data` were scanned both by key name and by value (any float in Singapore's
    longitude range, which would have caught a name we'd never guess): zero hits. The
    listing page does carry them, but returns the identical value to the project page --
    position is a property-level fact, so reading it here costs no extra page loads.
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
_GALLERY_ITEM_RE = re.compile(r'<span class="gallery-item image"[^>]*>\s*<img\b([^>]*)>')
_IMG_ATTR_RE = re.compile(r'\b(src|data-original)="([^"]*)"')
_GEO_META_RE = re.compile(
    r'<meta property="place:location:(latitude|longitude)" content="([^"]+)"'
)
_GEO_CANVAS_RE = re.compile(
    r'id="map-canvas"[^>]*?\bdata-latitude="([^"]*)"[^>]*?\bdata-longitude="([^"]*)"'
)
_TAG_RE = re.compile(r"<[^>]*>")

# The two extractors below run inside the browser, on the raw response text of a page the
# session fetched rather than navigated to. Each is the body of a function taking `text`
# and returning the reduced markup, and each exists to keep a megabyte of ads, scripts and
# images from crossing the WebDriver channel for the few hundred bytes that get parsed.
#
# They are deliberately written to emit exactly what the regexes above already match, so
# the Python side cannot tell a reduced page from a whole one. Changing a regex up there
# means changing its extractor down here.
_SEARCH_EXTRACT_JS = r"""
var open = text.indexOf('<script id="__NEXT_DATA__"');
if (open < 0) { return ''; }
var start = text.indexOf('>', open);
if (start < 0) { return ''; }
var end = text.indexOf('</script>', start);
if (end < 0) { return ''; }
// Re-wrapped rather than sliced whole, because the real tag carries attributes after the
// type that _NEXT_DATA_RE tolerates but does not need.
return '<script id="__NEXT_DATA__" type="application/json">'
    + text.slice(start + 1, end)
    + '</script>';
"""

_PROJECT_EXTRACT_JS = r"""
var out = [];
var rows = text.match(/<tr class="property-attr[\s\S]*?<\/tr>/g);
if (rows) { out = out.concat(rows); }
var image = text.match(/<meta property="og:image" content="[^"]*"[^>]*>/);
if (image) { out.push(image[0]); }
// The gallery, matching _GALLERY_ITEM_RE. Bounded by \s* rather than [\s\S]*? so a span
// that carries no image cannot swallow the markup up to the next one's.
var gallery = text.match(/<span class="gallery-item image"[^>]*>\s*<img\b[^>]*>/g);
if (gallery) { out = out.concat(gallery); }
// The literal ' content="' form, matching _GEO_META_RE, so this stays on the real markup
// rather than on the escaped copy of it further down the page.
var geo = text.match(
    /<meta property="place:location:(?:latitude|longitude)" content="[^"]*"[^>]*>/g
);
if (geo) { out = out.concat(geo); }
var canvas = text.match(/<[a-zA-Z][^>]*id="map-canvas"[^>]*>/);
if (canvas) { out.push(canvas[0]); }
return out.join('\n');
"""


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
        """Return one normalised record per organic listing card on a search-results page."""
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
            if self._is_promoted_ad(card):
                continue
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

    def search_extract_js(self) -> str:
        """Return the in-browser reducer for a search page: __NEXT_DATA__ and nothing else."""
        return _SEARCH_EXTRACT_JS

    @staticmethod
    def _is_promoted_ad(card: dict) -> bool:
        """True for an ad slot the ad server injected into the results grid.

        These are not search hits. They are sold by position, so they ignore the query's
        filters completely: a "TOP from 2020" search comes back with a 2001 project in
        one, a "1300 sqft and up" search with an 1184 sqft unit, and the same listing
        reappears across searches that share no filters at all. Left in, they read as the
        filter being broken, because from the page they are indistinguishable from a hit.

        Three markers pick out exactly the same cards -- the ad server's own tracking
        payload, the promoted flag, and the analytics ad product -- and any one is enough,
        so renaming one on the site's side cannot quietly let the ads back in.

        NOT `products.isPromotedListing`, despite the name: that one is also true for a
        Turbo listing that matched the search on its own merits, and dropping those would
        lose real results.
        """
        products = (card.get("listingData") or {}).get("products") or {}
        meta = (
            card.get("segment", {})
            .get("parameters", {})
            .get("metaData", {})
            .get("listingData")
            or {}
        )
        return (
            "kevel" in card
            or products.get("isPromoted") is True
            or meta.get("adProduct") == "promoted"
        )

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
        media = (listing.get("mediaCarousel") or {}).get("previewMedia") or {}
        plans = (media.get("floorPlans") or {}).get("items") or []
        photos = (media.get("images") or {}).get("items") or []

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
            # Only the src: see the module docstring on why `caption` is useless here.
            "floorplans": [plan.get("src") for plan in plans if plan.get("src")],
            "photos": [photo.get("src") for photo in photos if photo.get("src")],
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
        latitude, longitude = self._geo(html)

        return {
            "topYear": self._as_int(attrs.get("completion year")),
            "totalUnits": self._as_int(attrs.get("total units")),
            "floors": self._as_int(attrs.get("# of floors")),
            "tenure": attrs.get("tenure") or "",
            "developer": attrs.get("developer") or "",
            "propertyType": attrs.get("project type") or "",
            "psfRange": attrs.get("psf") or "",
            "imageUrl": image_match.group(1) if image_match else "",
            # Always present, an empty list included, for the reason the coordinates
            # below are: store._is_current reads the key's absence as "written before
            # the parser read the gallery" and refetches. A project that genuinely has
            # no gallery must still say so, or it is refetched on every search forever.
            "photos": self._gallery(html),
            # Always both keys, None included: store.get_property_cache reads their
            # absence as "written before coordinates were captured" and refetches. A page
            # that genuinely has no point must therefore still say so, or it would be
            # refetched on every search forever.
            "latitude": latitude,
            "longitude": longitude,
        }

    def project_extract_js(self) -> str:
        """Return the in-browser reducer for a project page: the rows, gallery and geo."""
        return _PROJECT_EXTRACT_JS

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
    def _gallery(html: str) -> list:
        """Return the project gallery's photos, in the order the carousel lists them.

        Only the first few items carry the real URL in `src`; the rest carry a shared
        placeholder there and the real one in `data-original`, so reading `src` alone
        would report every project as having three photos of nine.
        """
        photos = []
        for attrs in _GALLERY_ITEM_RE.findall(html or ""):
            found = dict(_IMG_ATTR_RE.findall(attrs))
            url = found.get("data-original") or found.get("src") or ""
            # The placeholder is one shared asset, so a span still waiting on its lazy
            # source would otherwise land in the carousel as a blank grey frame.
            if not url or "placeholder" in url:
                continue
            if url not in photos:
                photos.append(url)
        return photos

    @classmethod
    def _geo(cls, html: str) -> tuple:
        """Return (latitude, longitude) from a project page, or (None, None).

        Two carriers rather than one, because a missing coordinate does not look like a
        failure anywhere downstream -- the property simply stops appearing on the map,
        which reads as the map being wrong. Both must agree on being present: half a
        point is not a position, so a page offering only one is treated as offering none.
        """
        meta = dict(_GEO_META_RE.findall(html or ""))
        latitude = cls._as_float(meta.get("latitude"))
        longitude = cls._as_float(meta.get("longitude"))

        if latitude is None or longitude is None:
            canvas = _GEO_CANVAS_RE.search(html or "")
            if canvas:
                latitude = cls._as_float(canvas.group(1))
                longitude = cls._as_float(canvas.group(2))

        if latitude is None or longitude is None:
            return None, None
        # Anything outside Singapore is a parse that latched onto the wrong element, not
        # a property in another country, and a stray point drags the map's fit with it.
        if not (1.15 <= latitude <= 1.50 and 103.55 <= longitude <= 104.10):
            return None, None
        return latitude, longitude

    @staticmethod
    def _as_float(value):
        """Coerce a coordinate string to a float, or None when it is not a number."""
        if value is None or value == "":
            return None
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return float(value)
        try:
            return float(str(value).strip())
        except ValueError:
            return None

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
