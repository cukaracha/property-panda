"""
Random Number Tool Lambda

Dual-entrypoint:
- AgentCore Gateway tool target: returns a BARE dict (the gateway turns the return value
  into the MCP tool result).
- REST API (API Gateway, Cognito-authorized): responds via the aws_utils layer with the
  {statusCode, body} envelope.

Takes no input — it just generates a random integer between 1 and 100.
"""

import random

from aws_utils import lambda_utils


def main() -> dict:
    return {"random_number": random.randint(1, 100)}


def lambda_handler(event, context):
    # AgentCore Gateway tool path: bare dict out (no statusCode/body envelope).
    if lambda_utils.is_gateway_invocation(event, context):
        return main()

    # REST API path: CORS preflight + {statusCode, body} envelope via aws_utils.
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        return lambda_utils.success_response(main())
    except Exception as e:
        print(f"Error generating random number: {str(e)}")
        return lambda_utils.server_error(str(e))
