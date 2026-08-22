"""
Delete User Lambda Function

Deletes a user from the Cognito user pool.
Admin-only endpoint.
"""

import os
import boto3
from aws_utils import lambda_utils, auth_context


cognito_client = boto3.client('cognito-idp')


def main(username):
    user_pool_id = os.environ['USER_POOL_ID']

    if not username:
        raise ValueError("Username is required")

    cognito_client.admin_delete_user(
        UserPoolId=user_pool_id,
        Username=username,
    )

    return {'message': f'User {username} deleted successfully.'}


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        auth = auth_context.get_auth_context(event)
        if not auth.is_admin:
            return lambda_utils.forbidden('Admins only')

        query_params = event.get('queryStringParameters') or {}
        username = query_params.get('username', '')

        result = main(username)
        return lambda_utils.success_response(result)

    except ValueError as e:
        return lambda_utils.bad_request(str(e))
    except cognito_client.exceptions.UserNotFoundException:
        return lambda_utils.not_found('User not found')
    except Exception as e:
        print(f"Error deleting user: {str(e)}")
        return lambda_utils.server_error(str(e))
