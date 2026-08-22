import boto3
import os
import json


def get_secret(secret_name):
    # Defaulting to ap-southeast-1 based on common AWS region usage
    region_name = os.getenv("AWS_REGION", "ap-southeast-1")
    client = boto3.client(service_name='secretsmanager',
                          region_name=region_name)
    try:
        get_secret_value_response = client.get_secret_value(
            SecretId=secret_name)
    except Exception as e:
        print(f"ERROR: Could not retrieve secret {secret_name}: {e}")
        raise e
    else:
        if 'SecretString' in get_secret_value_response:
            return json.loads(get_secret_value_response['SecretString'])
        else:
            return get_secret_value_response['SecretBinary']


def set_env_from_secret(secret_arn: str):
    """
    Retrieves API keys from a secret ARN and sets them as environment variables.
    """
    if not secret_arn:
        raise ValueError("SECRET_ARN environment variable not set.")

    api_secrets = get_secret(secret_arn)

    for key, value in api_secrets.items():
        os.environ[key] = value
        print(f"Environment variable '{key}' has been set.")
