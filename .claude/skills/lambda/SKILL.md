---
name: lambda
description:
  Python Lambda conventions for this project - top-of-file docstring,
  handler/main() separation, the aws_utils layer for CORS/OPTIONS and responses,
  python 3.12, and shared Lambda-layer structure. Use when writing or editing a
  Lambda function or a shared Lambda layer.
---

# Lambda functions & layers

Python Lambda functions run on **python 3.12**. Each file starts with a
docstring, the handler stays thin, and responses go through the shared
`aws_utils` layer.

## Function structure

- **Docstring first** - a short top-of-file docstring describing what the
  function does.
- **`lambda_handler` is thin** - it only handles OPTIONS, parses the request,
  formats the response, and maps errors. No business logic.
- **`main()` orchestrates** - it reads its inputs/env, calls helper functions to
  do the work, and returns a plain result dict. Keep business logic in helpers,
  out of the handler.
- **Read config from `os.environ`, never hardcode** - resource names, ids,
  stages, and values like the Cognito pool id or `APPROVED_DOMAINS` are injected
  by Terraform (sourced from `AppConfig.json` or resource attributes); read them
  in `main()` (e.g. `os.environ['USER_POOL_ID']`). Never embed a literal name /
  ARN / stage / domain in the function.
- **Use the `aws_utils` layer** - `lambda_utils.handle_options(event)` at the
  very top; return via `lambda_utils.success_response()` / `bad_request()` /
  `error_response()` / `not_found()` / `unauthorized()` / `forbidden()` /
  `server_error()`.

Template (mirrors the project's existing handlers):

```python
"""
Create User Lambda Function

Creates a new user in the Cognito user pool and adds them to the requested group.
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


def main(email, group):
    user_pool_id = os.environ['USER_POOL_ID']
    # ... call helpers to do the work ...
    return {'message': f'User {email} created and added to {group} group.'}


def lambda_handler(event, context):
    options_response = lambda_utils.handle_options(event)
    if options_response:
        return options_response

    try:
        request_body = parse_request(event)
        email = request_body.get('email', '')
        group = request_body.get('group', 'Users')

        result = main(email, group)
        return lambda_utils.success_response(result)

    except ValueError as e:
        return lambda_utils.bad_request(str(e))
    except Exception as e:
        print(f"Error creating user: {str(e)}")
        return lambda_utils.server_error(str(e))
```

`aws_utils.lambda_utils` provides the CORS headers and helpers - never
hand-build response dicts or CORS headers in a handler:

```python
def handle_options(event):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}
    return None

def success_response(data, status_code=200):
    return {'statusCode': status_code, 'headers': CORS_HEADERS, 'body': json.dumps(data, default=str)}

def bad_request(message):   return error_response(400, message, 'BadRequest')
def not_found(message):     return error_response(404, message, 'NotFound')
def unauthorized(message='Unauthorized'): return error_response(401, message, 'Unauthorized')
def forbidden(message='Forbidden'):       return error_response(403, message, 'Forbidden')
def server_error(message='Internal server error'): return error_response(500, message, 'ServerError')

# Branch a dual-entrypoint Lambda (AgentCore Gateway tool vs. REST) - see below.
def is_gateway_invocation(event, context): ...  # True for a gateway tool target
```

## Dual-entrypoint (AgentCore Gateway tool + REST API)

One Lambda can serve **both** an AgentCore Gateway tool target **and** a
Cognito-authorized REST endpoint. The two callers differ in event shape and in
the response they expect, so the handler branches at the top on
**`lambda_utils.is_gateway_invocation(event, context)`** (the shared layer
helper above):

- **Gateway path** - the gateway passes the **raw tool args as `event`**
  (matching the tool's `input_schema`; an arg-less tool gets `{}`), and puts
  metadata in `context.client_context.custom` (`bedrockAgentCoreToolName`, …).
  The user's JWT/claims are **not** forwarded. **Return a bare dict** - the
  gateway turns the return value into the MCP tool result. Never wrap it in the
  `{statusCode, body}` envelope.
- **REST path** - a normal API Gateway proxy event (carries `requestContext`).
  Respond exactly as a normal handler: `handle_options` first, then
  `success_response()` / error helpers.

Keep business logic in `main()` so both paths share it. Compact template:

```python
"""Random Number Tool Lambda - dual-entrypoint (AgentCore Gateway tool + REST API)."""
import random
from aws_utils import lambda_utils


def main() -> dict:
    return {"random_number": random.randint(1, 100)}


def lambda_handler(event, context):
    # AgentCore Gateway tool path: bare dict out (no envelope).
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
```

Wiring (see `infra/terraform/ai_tools.tf`, `infra/terraform/ai_gateway.tf`,
`infra/terraform/backend_api.tf`): the **same** `aws_lambda_function` is the
gateway target's `lambda_arn` (via `aws_bedrockagentcore_gateway_target`)
**and** an `AWS_PROXY` integration on a REST route. Give the gateway service
resource-based `lambda:InvokeFunction` permission
(`principal = "bedrock-agentcore.amazonaws.com"`) alongside the usual
`apigateway.amazonaws.com` one.

## Shared Lambda layers

Shared code lives in layers under `apps/shared/lambda_layers/<layer_name>/`. A
Python layer is **just a zip with a specific internal shape**: AWS extracts a
layer to `/opt`, and the Python runtime puts `/opt/python` on `sys.path`. So the
zip must have a top-level `python/` directory, and inside it a package directory
whose name **is** the import name. That is why there are two `aws_utils`
levels - they mean different things:

- the **outer** `aws_utils/` is the layer's home/name (where the source and
  Terraform refer to it); it is NOT importable,
- the **inner** `python/aws_utils/` is the importable Python package - the name
  in `from aws_utils import ...`.

```
apps/shared/lambda_layers/
└── aws_utils/                  # layer home / layer name (NOT importable)
    └── python/                 # becomes /opt/python (added to sys.path)
        └── aws_utils/          # the importable package → from aws_utils import ...
            ├── __init__.py
            ├── lambda_utils.py
            └── auth_context.py
```

At runtime `/opt/python` is on `sys.path`, so
`from aws_utils import lambda_utils` resolves to
`/opt/python/aws_utils/lambda_utils.py`. Always import layer modules by name,
never by file path. (Dropping the inner package dir - `.py` files directly under
`python/` - would instead expose them as top-level modules, e.g.
`import lambda_utils`.)

There are two ways to produce the zip, depending on whether the layer needs pip
packages.

**No pip dependencies (what this repo does).** Store the modules pre-arranged at
`<layer>/python/<package>/*.py` and let Terraform zip the layer dir directly -
**no build script needed**. In `infra/terraform/backend_shared.tf`, an
`archive_file` data source points `source_dir` at the layer dir (so its
`python/` subtree becomes the zip's top level), and `aws_lambda_layer_version`
publishes it:

```hcl
data "archive_file" "aws_utils_layer" {
  type        = "zip"
  source_dir  = "${path.module}/../apps/shared/lambda_layers/aws_utils"
  output_path = "${path.module}/build/aws_utils_layer.zip"
}

resource "aws_lambda_layer_version" "aws_utils" {
  layer_name          = "${local.name_prefix}-aws-utils-layer"
  filename            = data.archive_file.aws_utils_layer.output_path
  source_code_hash    = data.archive_file.aws_utils_layer.output_base64sha256
  compatible_runtimes = ["python3.12"]
}
```

Functions attach it with `layers = [aws_lambda_layer_version.aws_utils.arn]`
(see `infra/terraform/backend_auth.tf`).

**With pip dependencies (not used in this repo yet).** Because `archive_file`
can only zip files that already exist, a layer with pip deps needs a build step
to vendor packages into `python/` for the target runtime
(`pip install -r requirements.txt --target python/`) alongside your own
`python/<package>/` modules, before the same `archive_file` zips the result.
(The Docker-based `build_layer.sh` under `samples/sample-web` is an unrelated
sample with a different `bin/`-based layout and is not wired into this
Terraform - don't assume it applies here.)

## Gotchas

- **Two `aws_utils` levels.** The outer `aws_utils/` is the layer home and is
  not importable. The inner `python/aws_utils/` is the import name. Always
  import by name (`from aws_utils import ...`), never by file path.
- **Gateway path returns a bare dict.** On the AgentCore Gateway tool path,
  return the raw result dict. Never wrap it in the `{statusCode, body}` envelope
  (that is the REST path only).
- **Gateway path does not forward the user's JWT/claims.** A gateway invocation
  carries only the raw tool args as `event`, so don't expect auth context there.
- **Don't reuse `samples/sample-web/build_layer.sh`.** It is an unrelated
  Docker-based sample with a different layout and is not wired into this
  Terraform.

## Known-good defaults

| Thing                    | Value                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| Runtime                  | `python3.12`                                                                                     |
| `compatible_runtimes`    | `["python3.12"]`                                                                                 |
| Gateway invoke principal | `bedrock-agentcore.amazonaws.com`                                                                |
| Layer name               | `${local.name_prefix}-aws-utils-layer`                                                           |
| Response helpers         | `success_response` / `bad_request` / `not_found` / `unauthorized` / `forbidden` / `server_error` |

## Verify (read-only)

```bash
python -m py_compile <function>.py          # syntax-check the handler
cd infra/terraform && terraform validate              # validates the archive_file / layer wiring
```
