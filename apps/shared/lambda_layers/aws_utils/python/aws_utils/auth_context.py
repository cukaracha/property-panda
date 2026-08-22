"""
Auth Context utility for extracting user claims from API Gateway events.

Works with the Cognito User Pools Authorizer (claims in authorizer.claims).

Usage:
    from aws_utils import auth_context

    def lambda_handler(event, context):
        auth = auth_context.get_auth_context(event)
        print(f"User: {auth.user_id}, Role: {auth.primary_role}")

        if auth.is_admin:
            # Admins-only logic
            pass
"""

from dataclasses import dataclass
from typing import List, Dict, Any
import json


@dataclass
class AuthContext:
    """
    Authentication context extracted from API Gateway event.

    Attributes:
        user_id: Cognito user sub (unique identifier)
        email: User's email address
        groups: List of Cognito groups (e.g., ['Admins'], ['Users'])
        primary_role: Primary role derived from groups ('Admins', 'Users', 'Unknown')
        account_status: Account status ('active', 'suspended')
    """
    user_id: str
    email: str
    groups: List[str]
    primary_role: str
    account_status: str

    @property
    def is_admin(self) -> bool:
        """Check if user is in Admins group."""
        return 'Admins' in self.groups

    @property
    def is_user(self) -> bool:
        """Check if user is in Users group."""
        return 'Users' in self.groups

    @property
    def is_active(self) -> bool:
        """Check if account is active (not suspended)."""
        return self.account_status == 'active'


class AuthContextError(Exception):
    """Raised when auth context cannot be extracted from event."""
    pass


def get_auth_context(event: Dict[str, Any]) -> AuthContext:
    """
    Extract authentication context from a Cognito User Pools Authorizer event.

    Args:
        event: API Gateway Lambda proxy event

    Returns:
        AuthContext with user information

    Raises:
        AuthContextError: If user_id cannot be extracted
    """
    authorizer = event.get('requestContext', {}).get('authorizer', {})

    if not authorizer:
        raise AuthContextError('No authorizer context found in event')

    claims = authorizer.get('claims', {})

    if not claims:
        raise AuthContextError('No claims found in authorizer context')

    user_id = claims.get('sub', '')
    email = claims.get('email', '')

    # Groups can come in multiple formats from the Cognito User Pools Authorizer:
    # 1. JSON array string: '["Admins", "Users"]'
    # 2. Space-separated string: 'Admins Users'
    # 3. Single group string: 'Admins'
    # 4. Already parsed list: ['Admins', 'Users']
    groups = _parse_groups(claims.get('cognito:groups', ''))

    primary_role = _get_primary_role(groups)
    account_status = claims.get('custom:accountStatus', 'active')

    if not user_id:
        raise AuthContextError('Could not extract user_id from event')

    return AuthContext(
        user_id=user_id,
        email=email,
        groups=groups,
        primary_role=primary_role,
        account_status=account_status
    )


def _parse_groups(groups_raw) -> List[str]:
    """Parse groups from the various formats Cognito may emit."""
    if not groups_raw:
        return []

    if isinstance(groups_raw, list):
        return groups_raw

    if isinstance(groups_raw, str):
        try:
            parsed = json.loads(groups_raw)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass

        groups_raw = groups_raw.strip()
        if not groups_raw:
            return []

        return groups_raw.split()

    return []


def _get_primary_role(groups: List[str]) -> str:
    """Determine primary role from group membership. Priority: Admins > Users > Unknown."""
    if 'Admins' in groups:
        return 'Admins'
    elif 'Users' in groups:
        return 'Users'
    return 'Unknown'
