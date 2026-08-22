"""
Self Sign-Up Lambda Function

Public endpoint that lets a visitor request an account. The email's domain is
validated against a pre-approved list; if allowed, a Cognito user is created
(which emails a temporary password) and added to the standard Users group.
"""

import json
import os
import boto3
from aws_utils import lambda_utils


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


def check_domain(email, approved_domains):
    if not approved_domains:
        raise PermissionError("Self-signup is currently disabled. Please contact your administrator.")

    if "*" in approved_domains:
        return

    domain = email.split('@')[1]
    if domain not in approved_domains:
        raise PermissionError("Your email domain is not pre-approved for self-signup. Please contact your administrator for access.")


def create_cognito_user(email, user_pool_id, user_group):
    cognito_client.admin_create_user(
        UserPoolId=user_pool_id,
        Username=email,
        UserAttributes=[
            {'Name': 'email', 'Value': email},
            {'Name': 'email_verified', 'Value': 'true'},
        ],
        DesiredDeliveryMediums=['EMAIL'],
    )
    cognito_client.admin_add_user_to_group(
        UserPoolId=user_pool_id,
        Username=email,
        GroupName=user_group,
    )


def main(email):
    user_pool_id = os.environ['USER_POOL_ID']
    user_group = os.environ['USER_GROUP']
    approved_domains = json.loads(os.environ['APPROVED_DOMAINS'])

    email = validate_email(email)
    check_domain(email, approved_domains)
    create_cognito_user(email, user_pool_id, user_group)

    return {'message': 'Account created! Check your email for a temporary password. Use it to log in and you will be prompted to set a new password.'}


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        request_body = parse_request(event)
        email = request_body.get('email', '')

        result = main(email)
        return lambda_utils.success_response(result)

    except ValueError as e:
        return lambda_utils.bad_request(str(e))
    except PermissionError as e:
        return lambda_utils.forbidden(str(e))
    except cognito_client.exceptions.UsernameExistsException:
        return lambda_utils.error_response(409, 'An account with this email already exists', 'Conflict')
    except Exception as e:
        print(f"Error creating user: {str(e)}")
        return lambda_utils.server_error(str(e))
