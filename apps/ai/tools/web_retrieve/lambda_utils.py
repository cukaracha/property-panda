"""Generic Lambda utilities for API Gateway handlers."""
import json

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
}


def is_gateway_invocation(event, context) -> bool:
    """True when invoked by an AgentCore Gateway tool target (vs. an API Gateway proxy event).

    The gateway sets context.client_context.custom['bedrockAgentCoreToolName'] and passes the
    raw tool args as the event; API Gateway proxy events carry 'requestContext'. Branch on this
    to pick the response format: gateway tools return a bare dict, REST endpoints return the
    {statusCode, body} envelope (success_response / error helpers).
    """
    custom = getattr(getattr(context, 'client_context', None), 'custom', None) or {}
    return 'bedrockAgentCoreToolName' in custom or 'requestContext' not in event


def handle_options(event):
    """Handle CORS preflight OPTIONS request. Returns response or None."""
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}
    return None


def success_response(data, status_code=200):
    """Build successful API response with CORS headers."""
    return {
        'statusCode': status_code,
        'headers': CORS_HEADERS,
        'body': json.dumps(data, default=str)
    }


def error_response(status_code, message, error_type='Error'):
    """Build error API response with CORS headers."""
    return {
        'statusCode': status_code,
        'headers': CORS_HEADERS,
        'body': json.dumps({'error': error_type, 'message': message})
    }


def bad_request(message):
    """400 Bad Request response."""
    return error_response(400, message, 'BadRequest')


def not_found(message):
    """404 Not Found response."""
    return error_response(404, message, 'NotFound')


def unauthorized(message='Unauthorized'):
    """401 Unauthorized response."""
    return error_response(401, message, 'Unauthorized')


def forbidden(message='Forbidden'):
    """403 Forbidden response - user is authenticated but not authorized."""
    return error_response(403, message, 'Forbidden')


def server_error(message='Internal server error'):
    """500 Internal Server Error response."""
    return error_response(500, message, 'ServerError')
