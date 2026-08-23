"""
Listing source protocol.

One implementation per site. The worker only ever talks to this interface, so adding a
second portal later means adding a module here and registering it in get_source() -- no
change to the worker, the grouping or the API contract.
"""

from typing import Protocol


class ListingSource(Protocol):
    """A site the scraper knows how to read for-sale listings from."""

    name: str

    def build_search_url(self, filters: dict, page: int) -> str:
        """Return the search-results URL for one page of `filters`."""
        ...

    def parse_listings(self, html: str) -> list:
        """Return the normalised listing records embedded in a search-results page."""
        ...

    def total_pages(self, html: str) -> int:
        """Return how many result pages this search has, so the worker can stop early."""
        ...

    def project_url(self, listing: dict) -> str:
        """Return the project (property) page URL for a listing, or '' if unknown."""
        ...

    def parse_project(self, html: str) -> dict:
        """Return the property-level record embedded in a project page."""
        ...
