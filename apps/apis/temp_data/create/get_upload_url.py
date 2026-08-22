"""
Get Temp Upload URL Lambda Function

Generates an S3 presigned URL for uploading an asset to temporary storage (under
assets/<assetId>). The object is stored with a single generic content type — the
markdown converter dispatches on the file extension, not on Content-Type — so the
browser PUT only needs to send that same generic type to satisfy the signature.
"""

import json
import os
from botocore.exceptions import ClientError
from aws_utils import lambda_utils, s3_utils

temp_bucket_name = os.environ['TEMP_BUCKET_NAME']

# The browser PUT must send exactly this Content-Type to match the presigned URL.
UPLOAD_CONTENT_TYPE = 'application/octet-stream'


def main(asset_id: str) -> dict:
    s3_key = f"assets/{asset_id}"

    try:
        result = s3_utils.generate_presigned_upload_url(
            bucket_name=temp_bucket_name,
            object_key=s3_key,
            content_type=UPLOAD_CONTENT_TYPE,
            expires_in=3600
        )
        print(f"Generated presigned URL for {s3_key}")
        return result

    except Exception as e:
        print(f"Error generating presigned URL: {str(e)}")
        raise


def lambda_handler(event, context):
    print(f"Event: {json.dumps(event)}")

    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        body = json.loads(event.get('body', '{}'))
        asset_id = body.get('assetId')

        if not asset_id:
            return lambda_utils.bad_request('Missing assetId in request body')

        if not asset_id.strip() or len(asset_id) > 255:
            return lambda_utils.bad_request('Invalid assetId')

        result = main(asset_id)
        return lambda_utils.success_response(result)

    except json.JSONDecodeError as e:
        print(f"JSON decode error: {str(e)}")
        return lambda_utils.bad_request(f'Invalid JSON in request body: {str(e)}')

    except ClientError as e:
        print(f"AWS error: {str(e)}")
        return lambda_utils.server_error(f'AWS service error: {str(e)}')

    except Exception as e:
        print(f"Unexpected error: {str(e)}")
        return lambda_utils.server_error(str(e))
