"""
Put Claude Token Lambda Function.

Stores the signed-in user's Claude subscription token so the ontology agent runs
its builds under their own subscription (PUT /profile/claude-token).

One secret holds a JSON map of {email: {token, updatedAt}}, and the caller's email
comes from the verified Cognito claim, so a user can only ever write their own key.
Sending an empty token removes the key.

Secrets Manager has no conditional write, so a naive read-modify-write would let
two users saving at the same time silently discard one of the tokens. This writes
the new map to a pending version and then moves the AWSCURRENT stage off the exact
version it read, which fails if anyone else moved it first, and retries from a
fresh read.
"""

import json
import os
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

from aws_utils import auth_context, lambda_utils

secrets_client = boto3.client('secretsmanager')

MAX_WRITE_ATTEMPTS = 5


def parse_request(event):
    if 'body' in event:
        try:
            return json.loads(event['body'] or '{}')
        except json.JSONDecodeError:
            raise ValueError("Invalid JSON in request body")
    return event


def read_current(secret_name):
    """Return (token map, version id of the version that map came from)."""
    response = secrets_client.get_secret_value(SecretId=secret_name)
    raw = response.get('SecretString') or '{}'

    tokens = json.loads(raw)
    if not isinstance(tokens, dict):
        raise ValueError("Claude token secret is not a JSON object")

    return tokens, response['VersionId']


def commit(secret_name, tokens, current_version_id):
    """
    Publish tokens as a pending version, then swing AWSCURRENT off
    current_version_id onto it. Returns False when someone else already moved
    AWSCURRENT, meaning our copy of the map is stale.
    """
    pending = secrets_client.put_secret_value(
        SecretId=secret_name,
        SecretString=json.dumps(tokens),
        VersionStages=['AWSPENDING']
    )

    try:
        secrets_client.update_secret_version_stage(
            SecretId=secret_name,
            VersionStage='AWSCURRENT',
            MoveToVersionId=pending['VersionId'],
            RemoveFromVersionId=current_version_id
        )
        return True

    except ClientError as e:
        if e.response['Error']['Code'] != 'InvalidParameterException':
            raise

        # Lost the race. Drop the orphaned pending version so repeated conflicts
        # don't accumulate versions, then let the caller retry from a fresh read.
        secrets_client.update_secret_version_stage(
            SecretId=secret_name,
            VersionStage='AWSPENDING',
            RemoveFromVersionId=pending['VersionId']
        )
        return False


def main(email: str, token: str) -> dict:
    """Merge the caller's token into the shared map, retrying on a lost race."""
    secret_name = os.environ['CLAUDE_TOKENS_SECRET']
    updated_at = datetime.now(timezone.utc).isoformat()

    for _ in range(MAX_WRITE_ATTEMPTS):
        tokens, version_id = read_current(secret_name)

        if token:
            tokens[email] = {'token': token, 'updatedAt': updated_at}
        else:
            tokens.pop(email, None)

        if commit(secret_name, tokens, version_id):
            return {
                'configured': bool(token),
                'updatedAt': updated_at if token else None,
                'maskedSuffix': token[-4:] if len(token) >= 4 else None,
            }

    raise RuntimeError(
        'Could not save the token because another save kept landing first. Please try again.'
    )


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        auth = auth_context.get_auth_context(event)

        if not auth.email:
            return lambda_utils.bad_request('No email claim on the signed-in user.')

        body = parse_request(event)
        token = ''.join((body.get('token') or '').split())

        return lambda_utils.success_response(main(auth.email, token))

    except ValueError as e:
        return lambda_utils.bad_request(str(e))
    except auth_context.AuthContextError as e:
        return lambda_utils.unauthorized(str(e))
    except Exception as e:
        print(f"Error saving Claude token: {str(e)}")
        return lambda_utils.server_error(str(e))
