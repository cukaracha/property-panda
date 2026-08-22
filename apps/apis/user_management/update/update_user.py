"""
Update User Lambda Function

Updates a Cognito user's attributes and/or group membership.
Admin-only endpoint.
"""

import json
import os
import boto3
from aws_utils import lambda_utils, auth_context


cognito_client = boto3.client('cognito-idp')


def parse_request(event):
    if 'body' in event:
        try:
            return json.loads(event['body'])
        except json.JSONDecodeError:
            raise ValueError("Invalid JSON in request body")
    return event


def update_attributes(user_pool_id, username, attributes):
    user_attributes = []
    if 'firstName' in attributes:
        user_attributes.append({'Name': 'given_name', 'Value': attributes['firstName']})
    if 'lastName' in attributes:
        user_attributes.append({'Name': 'family_name', 'Value': attributes['lastName']})

    if user_attributes:
        cognito_client.admin_update_user_attributes(
            UserPoolId=user_pool_id,
            Username=username,
            UserAttributes=user_attributes,
        )


def update_group(user_pool_id, username, new_group):
    response = cognito_client.admin_list_groups_for_user(
        UserPoolId=user_pool_id,
        Username=username,
    )
    current_groups = [g['GroupName'] for g in response.get('Groups', [])]

    for group in current_groups:
        if group != new_group:
            cognito_client.admin_remove_user_from_group(
                UserPoolId=user_pool_id,
                Username=username,
                GroupName=group,
            )

    if new_group not in current_groups:
        cognito_client.admin_add_user_to_group(
            UserPoolId=user_pool_id,
            Username=username,
            GroupName=new_group,
        )


def main(username, attributes, group):
    user_pool_id = os.environ['USER_POOL_ID']

    if not username:
        raise ValueError("Username is required")

    if attributes:
        update_attributes(user_pool_id, username, attributes)

    if group:
        update_group(user_pool_id, username, group)

    return {'message': f'User {username} updated successfully.'}


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        auth = auth_context.get_auth_context(event)
        if not auth.is_admin:
            return lambda_utils.forbidden('Admins only')

        request_body = parse_request(event)
        username = request_body.get('username', '')
        attributes = request_body.get('attributes')
        group = request_body.get('group')

        result = main(username, attributes, group)
        return lambda_utils.success_response(result)

    except ValueError as e:
        return lambda_utils.bad_request(str(e))
    except cognito_client.exceptions.UserNotFoundException:
        return lambda_utils.not_found('User not found')
    except Exception as e:
        print(f"Error updating user: {str(e)}")
        return lambda_utils.server_error(str(e))
