---
name: apis
description:
  How API Lambda functions are organized in this project - grouped by domain
  with CRUD verb subfolders under apps/apis/. Use when adding a new API
  endpoint, creating an API Lambda, or deciding where an endpoint's file should
  live.
---

# API organization

API Lambda functions are organized by **domain**, with **CRUD verb subfolders**
under each domain. Place each endpoint's file in the matching domain/verb
folder.

## Layout

```
apps/apis/
├── <domain>/                      # e.g. user_management, temp_data
│   ├── create/                    # POST-style endpoints
│   │   └── <verb>_<domain>.py     # e.g. create_user.py
│   ├── read/                      # GET-style endpoints
│   │   └── list_users.py
│   ├── update/                    # PUT/PATCH-style endpoints
│   │   └── update_user.py
│   └── delete/                    # DELETE-style endpoints
│       └── delete_user.py
```

Example: `apps/apis/user_management/create/create_user.py`.

## Rules

- **Group by domain first, then CRUD verb** - one folder per domain, one
  subfolder per `create` / `read` / `update` / `delete`.
- **Name the file `<verb>_<domain>.py`** so the file name reads like the action
  (`create_user.py`, `list_users.py`, `update_user.py`, `delete_user.py`).
- **Add a new endpoint** by dropping its file into the matching
  `<domain>/<verb>/` folder - create the domain or verb subfolder only when none
  fits.
- For the function code itself, each file uses a top-of-file docstring, a thin
  `lambda_handler` that delegates to `main()`, and `aws_utils` responses, on
  python 3.12. The full handler template is owned by the `lambda` skill (kept
  there to avoid duplicating the code block).

## Exposing the endpoint (REST wiring)

Writing the handler file does **not** route it - the endpoint only exists once
it's wired into the IaC. For an API Gateway REST API, add the route to the
per-feature route `locals` maps (one entry each in the `*_routes`, `*_cors`, and
`*_functions` maps) so the `for_each`'d method + `AWS_PROXY` integration, the
shared `cors` module's `OPTIONS` preflight, and the `aws_lambda_permission` are
all generated - there is no per-route HCL to copy. (That routing + CORS pattern
is owned by the `terraform` skill.)
