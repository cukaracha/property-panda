"""
Get Temp Download URL Lambda Function

Generates S3 presigned URLs for downloading files from temporary storage.
"""

import json
import os
from botocore.exceptions import ClientError
from aws_utils import lambda_utils, s3_utils

temp_bucket_name = os.environ['TEMP_BUCKET_NAME']


def main(key: str) -> dict:
    result = s3_utils.generate_presigned_download_url(
        bucket_name=temp_bucket_name,
        object_key=key,
        expires_in=900
    )
    print(f"Generated presigned download URL for {key}")
    return result


def lambda_handler(event, context):
    print(f"Event: {json.dumps(event)}")

    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        query_params = event.get('queryStringParameters') or {}
        key = query_params.get('key')

        if not key:
            return lambda_utils.bad_request('Missing key query parameter')

        # Constrain downloads to known prefixes so a presigned URL can never be minted
        # for arbitrary keys (e.g. another tenant's object or a traversal key): assets/
        # (uploads + converter output) and ontology/ (the ontology tool's flat files).
        if (not key.startswith('assets/') and not key.startswith('ontology/')) or '..' in key:
            return lambda_utils.forbidden('key must be under assets/ or ontology/')

        result = main(key)
        return lambda_utils.success_response(result)

    except ClientError as e:
        print(f"AWS error: {str(e)}")
        return lambda_utils.server_error(f'AWS service error: {str(e)}')

    except Exception as e:
        print(f"Unexpected error: {str(e)}")
        return lambda_utils.server_error(str(e))
