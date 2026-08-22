"""
List Users Lambda Function

Lists users in the Cognito user pool with optional group filtering and pagination.
Admin-only endpoint.
"""

import json
import os
import boto3
from aws_utils import lambda_utils, auth_context


cognito_client = boto3.client('cognito-idp')


def format_user(user):
    attributes = {}
    for attr in user.get('Attributes', user.get('UserAttributes', [])):
        attributes[attr['Name']] = attr['Value']

    groups = user.get('Groups', [])

    return {
        'username': user.get('Username', ''),
        'email': attributes.get('email', ''),
        'firstName': attributes.get('given_name', ''),
        'lastName': attributes.get('family_name', ''),
        'status': user.get('UserStatus', ''),
        'enabled': user.get('Enabled', True),
        'created': user.get('UserCreateDate', '').isoformat() if hasattr(user.get('UserCreateDate', ''), 'isoformat') else str(user.get('UserCreateDate', '')),
        'groups': groups,
    }


def get_user_groups(user_pool_id, username):
    response = cognito_client.admin_list_groups_for_user(
        UserPoolId=user_pool_id,
        Username=username,
    )
    return [g['GroupName'] for g in response.get('Groups', [])]


def list_all_users(user_pool_id, limit, pagination_token):
    params = {
        'UserPoolId': user_pool_id,
        'Limit': limit,
    }
    if pagination_token:
        params['PaginationToken'] = pagination_token

    response = cognito_client.list_users(**params)

    users = []
    for user in response.get('Users', []):
        user['Groups'] = get_user_groups(user_pool_id, user['Username'])
        users.append(format_user(user))

    return users, response.get('PaginationToken')


def list_users_in_group(user_pool_id, group_filter, limit, pagination_token):
    params = {
        'UserPoolId': user_pool_id,
        'GroupName': group_filter,
        'Limit': limit,
    }
    if pagination_token:
        params['NextToken'] = pagination_token

    response = cognito_client.list_users_in_group(**params)

    users = []
    for user in response.get('Users', []):
        user['Groups'] = [group_filter]
        users.append(format_user(user))

    return users, response.get('NextToken')


def main(limit, pagination_token, group_filter):
    user_pool_id = os.environ['USER_POOL_ID']

    if group_filter:
        users, next_token = list_users_in_group(user_pool_id, group_filter, limit, pagination_token)
    else:
        users, next_token = list_all_users(user_pool_id, limit, pagination_token)

    result = {'users': users}
    if next_token:
        result['paginationToken'] = next_token

    return result


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        auth = auth_context.get_auth_context(event)
        if not auth.is_admin:
            return lambda_utils.forbidden('Admins only')

        query_params = event.get('queryStringParameters') or {}
        limit = int(query_params.get('limit', '20'))
        pagination_token = query_params.get('paginationToken')
        group_filter = query_params.get('groupFilter')

        result = main(limit, pagination_token, group_filter)
        return lambda_utils.success_response(result)

    except Exception as e:
        print(f"Error listing users: {str(e)}")
        return lambda_utils.server_error(str(e))
