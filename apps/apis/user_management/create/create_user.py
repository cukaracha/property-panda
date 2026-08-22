"""
Admin Create User Lambda Function

Creates a new user in the Cognito user pool (admin-only, no domain restriction).
The user receives a temporary password via email and is added to the specified group.
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


def validate_email(email):
    if not email or '@' not in email:
        raise ValueError("Invalid email format")
    return email.strip().lower()


def create_cognito_user(email, user_pool_id, group, first_name=None, last_name=None):
    user_attributes = [
        {'Name': 'email', 'Value': email},
        {'Name': 'email_verified', 'Value': 'true'},
    ]
    if first_name:
        user_attributes.append({'Name': 'given_name', 'Value': first_name})
    if last_name:
        user_attributes.append({'Name': 'family_name', 'Value': last_name})

    cognito_client.admin_create_user(
        UserPoolId=user_pool_id,
        Username=email,
        UserAttributes=user_attributes,
        DesiredDeliveryMediums=['EMAIL'],
    )
    cognito_client.admin_add_user_to_group(
        UserPoolId=user_pool_id,
        Username=email,
        GroupName=group,
    )


def main(email, group, first_name=None, last_name=None):
    user_pool_id = os.environ['USER_POOL_ID']

    email = validate_email(email)
    group = group or 'Users'
    create_cognito_user(email, user_pool_id, group, first_name, last_name)

    return {'message': f'User {email} created and added to {group} group.'}


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        auth = auth_context.get_auth_context(event)
        if not auth.is_admin:
            return lambda_utils.forbidden('Admins only')

        request_body = parse_request(event)
        email = request_body.get('email', '')
        group = request_body.get('group', 'Users')
        first_name = request_body.get('firstName')
        last_name = request_body.get('lastName')

        result = main(email, group, first_name, last_name)
        return lambda_utils.success_response(result)

    except ValueError as e:
        return lambda_utils.bad_request(str(e))
    except cognito_client.exceptions.UsernameExistsException:
        return lambda_utils.error_response(409, 'A user with this email already exists', 'Conflict')
    except Exception as e:
        print(f"Error creating user: {str(e)}")
        return lambda_utils.server_error(str(e))
