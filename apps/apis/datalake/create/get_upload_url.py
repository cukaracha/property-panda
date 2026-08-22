"""
Get Datalake Upload URL Lambda.

Mints a presigned PUT into the bronze layer so the browser uploads raw documents
straight to S3 (POST /datalake/upload-url).

The object always lands at users/{cognito-sub}/{buildId}/{uuid}.{ext}. The sub
comes from the verified Cognito claim, never from the request, so a caller can
only ever write into their own prefix.
"""

import json
import os
import uuid

from aws_utils import auth_context, lambda_utils, s3_utils

BRONZE_BUCKET_NAME = os.environ['BRONZE_BUCKET_NAME']


def _validate_build_id(build_id):
    """A buildId is a plain uuid — never a client-supplied path fragment."""
    try:
        uuid.UUID(str(build_id))
    except (ValueError, AttributeError, TypeError):
        raise ValueError("buildId must be a valid build id")


def _asset_name(filename: str) -> str:
    """Mint an opaque object name, keeping only the extension from the filename."""
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    ext = ''.join(c for c in ext if c.isalnum())
    return f"{uuid.uuid4()}.{ext}" if ext else str(uuid.uuid4())


def main(user_sub: str, build_id: str, filename: str) -> dict:
    """Presign a bronze PUT under the caller's own build prefix."""
    _validate_build_id(build_id)

    if not filename or not isinstance(filename, str):
        raise ValueError("filename is required")

    object_key = s3_utils.user_prefix(user_sub, build_id) + _asset_name(filename)

    return s3_utils.generate_presigned_upload_url(BRONZE_BUCKET_NAME, object_key)


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        auth = auth_context.get_auth_context(event)
        body = json.loads(event.get('body', '{}'))

        return lambda_utils.success_response(
            main(auth.user_id, body.get('buildId'), body.get('filename'))
        )

    except ValueError as e:
        return lambda_utils.bad_request(str(e))
    except json.JSONDecodeError as e:
        return lambda_utils.bad_request(f"Invalid JSON in request body: {str(e)}")
    except auth_context.AuthContextError as e:
        return lambda_utils.unauthorized(str(e))
    except Exception as e:
        print(f"Error minting datalake upload URL: {str(e)}")
        return lambda_utils.server_error(str(e))
