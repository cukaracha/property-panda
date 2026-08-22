"""Who is asking, taken from the token the runtime already verified.

The runtime carries a Cognito JWT authorizer, so a request only reaches this process
if AgentCore validated the access token's signature, issuer, audience and expiry
first. The claims are therefore read here, not re-verified: re-checking a signature
the platform has already checked would add a JWKS fetch to every question without
adding a guarantee.

What it does NOT do is trust the payload. The sub comes from the header, never from
the request body, because the body is written by the browser and the header is the
thing that was signed. Everything downstream — the gold prefix, the vector filter,
the ownership check on the build — derives from this one value.
"""

import base64
import json


class IdentityError(Exception):
    """Raised when no usable identity can be read off the request."""


def _decode_segment(segment: str) -> dict:
    padded = segment + '=' * (-len(segment) % 4)
    return json.loads(base64.urlsafe_b64decode(padded.encode('utf-8')))


def user_sub_from_headers(headers) -> str:
    """The Cognito `sub` carried by the request's bearer token."""
    authorization = ''
    for name, value in (headers or {}).items():
        if name.lower() == 'authorization':
            authorization = value or ''
            break

    token = authorization.split(' ', 1)[1].strip() if ' ' in authorization else authorization
    if not token:
        raise IdentityError('the request carried no bearer token')

    parts = token.split('.')
    if len(parts) < 2:
        raise IdentityError('the bearer token is not a JWT')

    try:
        claims = _decode_segment(parts[1])
    except Exception as error:  # noqa: BLE001 - a malformed token is a client error
        raise IdentityError(f"the bearer token could not be read: {error}") from error

    sub = claims.get('sub')
    if not sub:
        raise IdentityError('the bearer token carries no sub claim')
    return str(sub)
