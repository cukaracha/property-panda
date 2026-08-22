"""
Get Claude Token Status Lambda Function.

Reports whether the signed-in user has stored a Claude subscription token for the
ontology agent to run its builds under (GET /profile/claude-token).

Deliberately never returns the token itself, only whether one is configured, when
it was last updated, and its last four characters so the user can tell which token
is stored. The caller's email comes from the verified Cognito claim, so a user can
only ever see the status of their own key.
"""

import os

from aws_utils import auth_context, lambda_utils, secrets_utils


def token_status(entry: dict) -> dict:
    """Shape one stored entry into a status the browser may safely see."""
    if not entry:
        return {'configured': False, 'updatedAt': None, 'maskedSuffix': None}

    token = entry.get('token', '')

    return {
        'configured': bool(token),
        'updatedAt': entry.get('updatedAt'),
        # Enough to distinguish two tokens, far too little to use as one.
        'maskedSuffix': token[-4:] if len(token) >= 4 else None,
    }


def main(email: str) -> dict:
    """Read the shared token map and report only the caller's own entry."""
    secret_name = os.environ['CLAUDE_TOKENS_SECRET']
    tokens = secrets_utils.get_secret_json(secret_name)

    return token_status(tokens.get(email))


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        auth = auth_context.get_auth_context(event)

        if not auth.email:
            return lambda_utils.bad_request('No email claim on the signed-in user.')

        return lambda_utils.success_response(main(auth.email))

    except auth_context.AuthContextError as e:
        return lambda_utils.unauthorized(str(e))
    except Exception as e:
        print(f"Error reading Claude token status: {str(e)}")
        return lambda_utils.server_error(str(e))
