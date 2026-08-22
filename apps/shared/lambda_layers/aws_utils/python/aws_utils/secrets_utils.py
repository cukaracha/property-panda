"""Secrets Manager utilities for Lambda functions."""
import boto3
import json


def get_secret(secret_name: str) -> str:
    """
    Retrieve a secret value from AWS Secrets Manager.

    Args:
        secret_name: The name or ARN of the secret

    Returns:
        The secret string value

    Raises:
        ValueError: If secret_name is not provided
    """
    if not secret_name:
        raise ValueError("secret_name is required")

    secrets_client = boto3.client('secretsmanager')
    response = secrets_client.get_secret_value(SecretId=secret_name)
    return response['SecretString']


def get_secret_json(secret_name: str) -> dict:
    """
    Retrieve a secret and parse it as a JSON object.

    Args:
        secret_name: The name or ARN of the secret

    Returns:
        The parsed secret as a dict (an empty dict when the secret is empty)

    Raises:
        ValueError: If secret_name is not provided or the secret is not a JSON object
    """
    raw = get_secret(secret_name) or '{}'
    parsed = json.loads(raw)

    if not isinstance(parsed, dict):
        raise ValueError(f"Secret {secret_name} is not a JSON object")

    return parsed
