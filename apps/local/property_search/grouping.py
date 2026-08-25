"""
Turn a flat list of listings into the grouped shape the UI renders.

listings -> properties -> unit types (by bedroom count) -> units

The shortlist is regrouped here too. It stores whole listings rather than references,
so it feeds the same helpers a fresh search result does.

The prototype had no grouping at all: it rendered one flat table keyed by project name,
which is why two units in the same project could not be compared side by side. Grouping
on the site's own numeric project id rather than the display name also stops two projects
that share a name from being merged.
"""


def group_listings(listings: list, properties: dict) -> list:
    """Group listings into properties, each with unit types ordered by bedroom count.

    `properties` maps propertyId -> the cached project record (may be missing entries;
    a property with no enrichment is still returned, flagged rather than dropped).
    """
    buckets = {}

    for listing in listings:
        property_id = listing.get("propertyId") or _fallback_id(listing)
        buckets.setdefault(property_id, []).append(listing)

    grouped = [
        _build_property(property_id, items, properties.get(property_id) or {})
        for property_id, items in buckets.items()
    ]

    # Cheapest property first: the entry price is what a buyer scans the list by.
    grouped.sort(key=lambda p: (p["priceMin"], p["name"]))
    return grouped


def group_shortlist(entries: list) -> list:
    """Group shortlisted units into the same property shape a search result returns.

    Each entry is a whole listing frozen at the moment it was shortlisted, which is the
    flat shape _build_unit_types already consumes, so the unit types, the overviews and
    the unit rows all come out of the helpers a search goes through unchanged.

    The project facts come with the entry rather than from the property cache, because a
    shortlist outlives both the job that found the unit and the cache row behind it.
    """
    buckets = {}
    for entry in entries:
        buckets.setdefault(entry.get("propertyId") or "", []).append(entry)

    grouped = []
    for property_id, items in buckets.items():
        # The store hands these over newest first, so the newest snapshot is the one
        # that names the property and describes the project.
        newest = items[0]
        prices = [item["price"] for item in items if item.get("price")]
        grouped.append(
            {
                "propertyId": property_id,
                "name": newest.get("propertyName") or "Unknown property",
                "priceMin": min(prices) if prices else 0,
                "unitCount": len(items),
                "info": newest.get("info") or {},
                "unitTypes": _build_unit_types(items),
                # When this property last gained a unit, so the page can show how old
                # the snapshot it is rendering actually is.
                "shortlistedAt": newest.get("createdAt"),
            }
        )

    grouped.sort(key=lambda p: (p["priceMin"], p["name"]))
    return grouped


def _build_property(property_id: str, listings: list, enrichment: dict) -> dict:
    """Assemble one property record from its listings plus its cached project record."""
    first = listings[0]

    unit_types = _build_unit_types(listings)
    prices = [item["price"] for item in listings if item.get("price")]

    return {
        "propertyId": property_id,
        "name": first.get("name") or "Unknown property",
        "priceMin": min(prices) if prices else 0,
        "unitCount": len(listings),
        "info": {
            "district": first.get("district") or "",
            "districtName": first.get("districtName") or "",
            "regionName": first.get("regionName") or "",
            "address": first.get("address") or "",
            # Project-page facts. None when enrichment never ran or the label was absent,
            # so the UI can show a fallback instead of a zero that reads as real data.
            "topYear": enrichment.get("topYear"),
            "totalUnits": enrichment.get("totalUnits"),
            "floors": enrichment.get("floors"),
            # Where the project sits, for the map. From the project page like the rest of
            # this block, not from the listing: the search feed carries no coordinates.
            "latitude": enrichment.get("latitude"),
            "longitude": enrichment.get("longitude"),
            # Tenure and developer appear on both sides. Prefer the project page's
            # human-readable form ("99-year Leasehold") over the listing's code ("L99").
            "tenure": enrichment.get("tenure") or _tenure_label(first.get("tenureCode")),
            "developer": enrichment.get("developer") or first.get("developer") or "",
            "propertyType": enrichment.get("propertyType") or first.get("propertyType") or "",
            "psfRange": enrichment.get("psfRange") or "",
            "projectUrl": enrichment.get("projectUrl") or "",
            "imageUrl": enrichment.get("imageUrl") or "",
            "enrichment": "ok" if enrichment.get("topYear") else "unavailable",
        },
        "unitTypes": unit_types,
    }


def _build_unit_types(listings: list) -> list:
    """Split one property's listings into unit types, one per bedroom count."""
    by_bedrooms = {}
    for listing in listings:
        by_bedrooms.setdefault(listing.get("bedrooms") or 0, []).append(listing)

    unit_types = []
    for bedrooms in sorted(by_bedrooms):
        units = by_bedrooms[bedrooms]
        unit_types.append(
            {
                "key": f"{bedrooms}br" if bedrooms else "unknown",
                "label": _bedroom_label(bedrooms),
                "bedrooms": bedrooms,
                "overview": _build_overview(units),
                "units": [
                    _build_unit(unit)
                    for unit in sorted(units, key=lambda u: u.get("price") or 0)
                ],
            }
        )
    return unit_types


def _build_unit(listing: dict) -> dict:
    """Project one listing down to the fields a unit row renders.

    Everything property-level (name, district, developer, tenure) is dropped here because
    it already sits once on the parent property. Carrying it per unit multiplied the
    payload by the number of listings for no gain.

    The photos are read as two independent keys, which is what lets the one helper serve
    both callers without knowing which one it is. A search result carries the count with
    an empty list, because the photos themselves are far too bulky to send with every
    unit and the scrape has already moved them into the store for the carousel to fetch.
    A shortlisted unit carries the list, snapshotted with the rest of the listing, and
    the count is derived from it.
    """
    return {
        "listingId": listing["listingId"],
        "price": listing.get("price"),
        "bathrooms": listing.get("bathrooms"),
        "floorAreaSqft": listing.get("floorAreaSqft"),
        "psf": listing.get("psf"),
        "url": listing.get("url") or "",
        "listedAt": listing.get("listedAt"),
        "listedLabel": listing.get("listedLabel") or "",
        "agentName": listing.get("agentName") or "",
        "agencyName": listing.get("agencyName") or "",
        "floorplans": listing.get("floorplans") or [],
        "photos": listing.get("photos") or [],
        "photoCount": listing.get("photoCount", len(listing.get("photos") or [])),
    }


def _build_overview(units: list) -> dict:
    """Aggregate one unit type: sqft, price and psf ranges, plus a typical size."""
    sqft = [u["floorAreaSqft"] for u in units if u.get("floorAreaSqft")]
    prices = [u["price"] for u in units if u.get("price")]
    psf = [u["psf"] for u in units if u.get("psf")]

    return {
        "sqftMin": min(sqft) if sqft else None,
        "sqftMax": max(sqft) if sqft else None,
        # Median, not mean: one penthouse in the bucket should not drag the "typical"
        # size away from what almost every unit of this type actually is.
        "typicalSqft": _median(sqft),
        "unitCount": len(units),
        "priceMin": min(prices) if prices else None,
        "priceMax": max(prices) if prices else None,
        "psfMin": min(psf) if psf else None,
        "psfMax": max(psf) if psf else None,
    }


def _median(values: list):
    """Middle value of a sorted copy, averaging the two middles on an even count."""
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return round((ordered[middle - 1] + ordered[middle]) / 2)


def _bedroom_label(bedrooms: int) -> str:
    """Human label for a unit-type tab."""
    if not bedrooms:
        return "Studio or unlisted"
    return f"{bedrooms} bedroom"


def _tenure_label(code: str) -> str:
    """Expand the listing feed's tenure code, falling back to the code itself."""
    if not code:
        return ""
    known = {"L99": "99-year leasehold", "L999": "999-year leasehold", "F": "Freehold"}
    return known.get(code, code)


def _fallback_id(listing: dict) -> str:
    """Group by slugified name when the feed omitted a project id."""
    name = (listing.get("name") or "unknown").lower()
    return "name:" + "-".join(part for part in name.split() if part)


def count_units(properties: list) -> int:
    """Total units across every property, for the job row's summary counters."""
    return sum(
        len(unit_type["units"]) for prop in properties for unit_type in prop["unitTypes"]
    )
