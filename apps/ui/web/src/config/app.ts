// App display name, sourced from AppConfig.json (the deploy pipeline writes
// VITE_APP_NAME into .env.production at build time). Falls back to a sensible
// default for local dev.
export const APP_NAME = import.meta.env.VITE_APP_NAME || 'JustifyAI';

// The in-app assistant's display name (neutral, debranded).
export const ASSISTANT_NAME = 'Learnoura';

// localStorage key for the persisted light/dark choice. MUST match the literal
// used in the no-flash inline script in index.html.
export const APP_THEME_KEY = 'app-theme';

// Optional federated OIDC single sign-on. The deploy pipeline writes
// VITE_COGNITO_DOMAIN into .env.production only when AppConfig.json configures a
// federatedIdp, so its presence is what enables the SSO button. SSO_PROVIDER MUST
// match the Cognito IdP provider name minted by the IaC (Cognito.ts / backend_auth.tf).
export const SSO_ENABLED = !!import.meta.env.VITE_COGNITO_DOMAIN;
export const SSO_PROVIDER = 'FederatedIdP';
export const SSO_BUTTON_LABEL = 'Single sign-on';

// Local mode. The property search page (apps/local/property_search) runs entirely on
// this machine against a loopback server with no Cognito in front of it, so the app has
// to be able to boot without a user pool — configureAmplify() throws outright when the
// pool id is absent. Gated on import.meta.env.DEV as well as the flag: Vite folds that
// constant to false when building for production and drops the branch, so no deployed
// bundle can ever take the unauthenticated path, whatever its .env says.
export const LOCAL_MODE = import.meta.env.DEV && import.meta.env.VITE_LOCAL_MODE === 'true';
