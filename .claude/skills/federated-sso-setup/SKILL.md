---
name: federated-sso-setup
description:
  Runbook for turning on the optional Microsoft Entra ID (Azure AD) / OIDC
  single sign-on button on the Cognito login page — register the IdP app, wire
  this pool's redirect URI, fill AppConfig.json, and run the two-phase deploy.
  Use when adding an SSO / "Sign in with Microsoft" button, configuring a
  federated OIDC identity provider, setting the `federatedIdp` block, populating
  the IdP client secret, or debugging `redirect_mismatch` / missing-secret /
  claim-mapping failures on federated login.
---

# Federated OIDC SSO — Entra → Cognito setup

The app supports **hybrid** login: a federated SSO button _alongside_ the
existing email/password form. Turning it on has two halves. The **IaC half is
already in the repo** (CDK + Terraform + frontend, gated on `AppConfig.json`
`federatedIdp`). This runbook is the **manual half** — register the IdP app, get
its client id + secret, wire this pool's redirect URI, and deploy in two phases.
The worked example is **Microsoft Entra ID**; any OIDC IdP works the same way
(Cognito auto-discovers the endpoints from the issuer URL).

Start-from-scratch assumption: no app registration, no client id, no secret yet.

## Enable switch

Off until `AppConfig.json` (repo root) has a `federatedIdp` block with **both**
fields non-empty:

```json
"federatedIdp": {
  "issuerUrl": "https://login.microsoftonline.com/<TENANT_ID>/v2.0",
  "clientId": "<APPLICATION_CLIENT_ID>"
}
```

Blank or omitted ⇒ no IdP, no OAuth on the app client, no button (byte-for-byte
the pre-SSO app). The client **secret is never in config** — it lives in Secrets
Manager (Step 5). "Enabled" = block present **and** both fields non-empty; the
same rule is enforced in `infra/cdk/lib/config.ts` and
`infra/terraform/locals.tf`.

## Prerequisites

- An Entra tenant + permission to register apps (**App registrations**).
- AWS deploy access for this app's account/region.
- The app deployable via `./deploy.sh` (CDK) or `terraform apply` (Terraform).
  The Cognito hosted-UI domain already exists after any Core deploy — even while
  SSO is disabled — so you can fetch the redirect URI before enabling anything.

## Step 1 — Get this pool's redirect URI

Cognito's federation callback is the fixed path `/oauth2/idpresponse` on this
pool's hosted-UI domain. It is deterministic:

```
https://{stage}-{appname}-{account}.auth.{region}.amazoncognito.com/oauth2/idpresponse
```

Confirm the exact host from the deploy output (domain exists even while
disabled):

```bash
# CDK — read the CoreStack output
aws cloudformation describe-stacks --stack-name {stage}-{appname}-CoreStack --region {region} \
  --query "Stacks[0].Outputs[?OutputKey=='CognitoUserPoolDomainBaseUrl'].OutputValue" --output text

# Terraform — read the output
terraform output -raw cognito_user_pool_domain_base_url
```

Append `/oauth2/idpresponse` to whatever prints. If nothing is deployed yet, run
`./deploy.sh stack=core` once first (still disabled — creates only the pool +
domain).

Current app:
`https://dev-sample-agentic-app-109542136611.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`

## Step 2 — Register the Entra app

Entra admin center → **Identity → Applications → App registrations → New
registration**:

- **Name:** an internal label (e.g. the app name). Not user-visible.
- **Supported account types:** _Accounts in this organizational directory only
  (single tenant)_ — matches the tenant-scoped issuer.
- **Redirect URI:** platform **Web**, value = the URI from Step 1.
- **Register.**

On the **Overview** page, copy:

- **Application (client) ID** → `federatedIdp.clientId`
- **Directory (tenant) ID** → goes into `issuerUrl`

**API permissions:** the default `User.Read` (Microsoft Graph, delegated) is
enough. `openid`/`email`/`profile` are OIDC scopes requested at runtime and need
no admin consent — optionally click **Grant admin consent** to suppress the
per-user consent prompt on first login.

## Step 3 — Create the client secret

**Certificates & secrets → Client secrets → + New client secret** → set a
description + expiry → **Add**. Copy the **Value** column **immediately** — it
is shown exactly once. (After this, Entra only ever shows the masked value; the
real value lives solely in Secrets Manager, Step 5.)

## Step 4 — Fill `AppConfig.json`

```json
"federatedIdp": {
  "issuerUrl": "https://login.microsoftonline.com/<DIRECTORY_TENANT_ID>/v2.0",
  "clientId": "<APPLICATION_CLIENT_ID>"
}
```

## Step 5 — Two-phase deploy

The secret can't be pasted until the IdP + its Secrets Manager placeholder
exist, so this is two passes. **Deploy commands create real infrastructure — run
them yourself.**

**CDK:**

```bash
# 1) create the IdP + placeholder secret + hybrid app client
./deploy.sh stack=core

# 2) paste the real secret value (plaintext = the raw Entra client-secret Value)
aws secretsmanager put-secret-value --region {region} \
  --secret-id {stage}-{appname}-federated-idp-client-secret \
  --secret-string '<CLIENT_SECRET_VALUE>'

# 3) re-deploy so Cognito resolves the real secret into the IdP
./deploy.sh stack=core

# 4) rebuild the SPA so VITE_COGNITO_DOMAIN is baked in (this renders the button)
./deploy.sh stack=ui
```

**Terraform** (user-run — never agent-run): `terraform apply` creates the
placeholder secret version + IdP + client; paste the real value with the same
`put-secret-value` (or the Console); `terraform apply` again re-reads it via the
data source and updates the IdP in place; the UI `null_resource.deploy_ui`
rebuilds the SPA with `VITE_COGNITO_DOMAIN`. **Never apply both trees to the
same account+stage.**

Concrete secret id for this app:
`dev-sample-agentic-app-federated-idp-client-secret`.

## Verify

- The login page shows the email/password form, an **"or"** divider, and a
  **"Single sign-on"** button.
- Click it → redirect to Entra → sign in → back to the app origin, authenticated
  and routed into the app.
- Password (SRP) login still works in parallel (hybrid — SSO did not replace
  it).

## Gotchas

- **Secret is one-time reveal.** A _working_ IdP shows no retrievable secret in
  Entra — that's normal; the value lives in Secrets Manager, not Entra. If you
  lose it, create a new client secret and re-paste (Step 3 + Step 5.2). An empty
  "Client secrets" list on a supposedly-working app means the secret expired and
  federated login is actually broken.
- **`redirect_mismatch` at login** ⇒ the exact browser origin
  (`window.location.origin`) must be a registered callback URL, which comes from
  `allowedOrigins` in `AppConfig.json`. It lists the custom domain + localhost
  but **not** the raw `*.cloudfront.net` URL — use the custom domain, or add the
  CloudFront origin (bare origin, no path).
- **Cognito rejects the login with a missing-attribute error** ⇒ the pool marks
  `given_name` + `family_name` (and `email`) **required**, so every Entra user
  signing in must have First name, Last name, and email populated. If some
  don't, force the claims via **Entra → Token configuration → Add optional claim
  → ID → `given_name`, `family_name`, `email`**.
- **Federated users have no `cognito:groups`.** They authenticate and can use
  the normal app, but admin/role-gated routes stay closed until an admin adds
  them to a group (`Admins`/`Users`) in Cognito. No pre-token Lambda ships.
- **`FederatedIdP` is a shared contract.** The provider name must stay identical
  in `infra/cdk/lib/constructs/core/Cognito.ts`,
  `infra/terraform/backend_auth.tf`, and `apps/ui/web/src/config/app.ts`
  (`SSO_PROVIDER`). Changing it is a code edit in all three, not a config
  change.
- **Two IaC trees.** Every infra change lands in both `infra/cdk` and
  `infra/terraform`; never apply both to the same account+stage.

## Known-good defaults

| Thing                       | Value                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| Cognito OIDC provider name  | `FederatedIdP` (identical in CDK `Cognito.ts`, TF `backend_auth.tf`, `config/app.ts` `SSO_PROVIDER`) |
| IdP authorize scopes        | `openid email profile`                                                                               |
| App-client OAuth scopes     | `openid email profile aws.cognito.signin.user.admin`                                                 |
| Redirect URI path           | `/oauth2/idpresponse` (fixed)                                                                        |
| Hosted-UI domain            | `{stage}-{appname}-{account}.auth.{region}.amazoncognito.com`                                        |
| Secrets Manager secret name | `{stage}-{appname}-federated-idp-client-secret`                                                      |
| Entra issuer                | `https://login.microsoftonline.com/<TENANT_ID>/v2.0`                                                 |
| Attribute mapping           | `email→email`, `given_name→given_name`, `family_name→family_name`                                    |
| Frontend enable flag        | presence of `VITE_COGNITO_DOMAIN` (written by deploy only when enabled)                              |
| Current app values          | resourcePrefix `dev-sample-agentic-app`, account `109542136611`, region `us-east-1`                  |
