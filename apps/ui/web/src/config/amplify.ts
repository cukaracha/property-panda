import { Amplify } from 'aws-amplify';

// Configure Amplify with environment variables (written by Terraform into .env.production).
export const configureAmplify = () => {
  const userPoolId = import.meta.env.VITE_USER_POOL_ID;
  const userPoolClientId = import.meta.env.VITE_USER_POOL_CLIENT_ID;
  // Hosted-UI domain (bare host, no scheme) — present only when a federated IdP
  // is configured. Its presence turns on the OAuth redirect path.
  const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN;

  if (!userPoolId || !userPoolClientId) {
    console.error('Missing required environment variables:', {
      userPoolId: !!userPoolId,
      userPoolClientId: !!userPoolClientId,
    });
    throw new Error(
      'AWS Cognito configuration is missing. Please check your environment variables.'
    );
  }

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        loginWith: {
          email: true,
          ...(cognitoDomain
            ? {
                oauth: {
                  domain: cognitoDomain,
                  scopes: ['openid', 'email', 'profile', 'aws.cognito.signin.user.admin'],
                  redirectSignIn: [window.location.origin],
                  redirectSignOut: [window.location.origin],
                  responseType: 'code',
                },
              }
            : {}),
        },
      },
    },
  });
};
