"""
Get Datalake Download URL Lambda.

Mints a presigned GET for one object in the medallion lake
(GET /datalake/download-url?layer=gold&key=users/{sub}/{buildId}/nodes.csv).

The key must sit under the caller's own users/{sub}/ prefix — checked against the
verified Cognito sub, not against anything in the request — so one user can never
presign another user's documents or ontology outputs.
"""

import os

from aws_utils import auth_context, lambda_utils, s3_utils

BUCKETS = {
    'bronze': os.environ['BRONZE_BUCKET_NAME'],
    'silver': os.environ['SILVER_BUCKET_NAME'],
    'gold': os.environ['GOLD_BUCKET_NAME'],
}


def main(user_sub: str, layer: str, object_key: str) -> dict:
    """Presign a read of one lake object the caller owns."""
    bucket = BUCKETS.get(layer)
    if not bucket:
        raise ValueError(f"layer must be one of {sorted(BUCKETS)}")

    s3_utils.assert_owned(object_key, user_sub)

    return s3_utils.generate_presigned_download_url(bucket, object_key)


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        auth = auth_context.get_auth_context(event)
        params = event.get('queryStringParameters') or {}

        return lambda_utils.success_response(
            main(auth.user_id, params.get('layer'), params.get('key'))
        )

    except ValueError as e:
        return lambda_utils.bad_request(str(e))
    except PermissionError as e:
        return lambda_utils.forbidden(str(e))
    except auth_context.AuthContextError as e:
        return lambda_utils.unauthorized(str(e))
    except Exception as e:
        print(f"Error minting datalake download URL: {str(e)}")
        return lambda_utils.server_error(str(e))
