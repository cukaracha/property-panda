import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import {
  signOut as amplifySignOut,
  signInWithRedirect,
  getCurrentUser,
  fetchUserAttributes,
  fetchAuthSession,
  type AuthUser,
} from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { configureAmplify } from '../config/amplify';
import { LOCAL_MODE, SSO_PROVIDER } from '../config/app';
import { clearAuthHeadersCache } from '../services/authUtils';
import { Spinner } from '../components/ui/spinner';
import { BrandLogo } from '../components/BrandLogo';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  userAttributes: Record<string, string> | null;
  name: string;
  userGroups: string[];
  isFederated: boolean;
  isAdmin: () => boolean;
  isUser: () => boolean;
  signInWithSso: () => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// The stand-in identity used in local mode, where there is no user pool to ask. It is
// deliberately not an admin: the admin screens drive APIs that only exist in the cloud.
const LOCAL_USER = { username: 'local', userId: 'local' } as AuthUser;
const LOCAL_ATTRIBUTES = { email: 'local@localhost', given_name: 'Local', family_name: 'User' };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [userAttributes, setUserAttributes] = useState<Record<string, string> | null>(null);
  const [userGroups, setUserGroups] = useState<string[]>([]);
  const [isFederated, setIsFederated] = useState(false);

  // Cognito groups live on the ID token (cognito:groups claim).
  const getUserGroups = async (): Promise<string[]> => {
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken;
      if (idToken) {
        const payload = JSON.parse(atob(idToken.toString().split('.')[1]));
        return payload['cognito:groups'] || [];
      }
      return [];
    } catch {
      return [];
    }
  };

  // Federated (SSO) users carry an `identities` claim naming the external IdP;
  // native email/password users don't. Decoded from the ID token, like groups.
  const getIsFederated = async (): Promise<boolean> => {
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken;
      if (idToken) {
        const payload = JSON.parse(atob(idToken.toString().split('.')[1]));
        const identities = payload['identities'];
        return Array.isArray(identities) && identities.some(i => i?.providerName === SSO_PROVIDER);
      }
      return false;
    } catch {
      return false;
    }
  };

  const checkAuth = async () => {
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);

      const attributes = await fetchUserAttributes();
      setUserAttributes(attributes as Record<string, string>);

      const groups = await getUserGroups();
      setUserGroups(groups);

      setIsFederated(await getIsFederated());

      setIsAuthenticated(true);
    } catch {
      setUser(null);
      setUserAttributes(null);
      setUserGroups([]);
      setIsFederated(false);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (LOCAL_MODE) {
      setUser(LOCAL_USER);
      setUserAttributes(LOCAL_ATTRIBUTES);
      setUserGroups(['Users']);
      setIsAuthenticated(true);
      setIsLoading(false);
      return;
    }

    configureAmplify();
    checkAuth();

    // Federated (OAuth redirect) sign-in resolves asynchronously via the Hub.
    // Inert when SSO is disabled — these events simply never fire.
    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      switch (payload.event) {
        case 'signInWithRedirect':
          checkAuth();
          break;
        case 'signInWithRedirect_failure':
        case 'signedOut':
          setUser(null);
          setUserAttributes(null);
          setUserGroups([]);
          setIsFederated(false);
          setIsAuthenticated(false);
          break;
      }
    });

    return unsubscribe;
  }, []);

  const isAdmin = () => userGroups.includes('Admins');
  const isUser = () => userGroups.includes('Users');

  const given = userAttributes?.given_name ?? '';
  const family = userAttributes?.family_name ?? '';
  const name = `${given} ${family}`.trim() || userAttributes?.email || '';

  const handleSignInWithSso = async () => {
    await signInWithRedirect({ provider: { custom: SSO_PROVIDER } });
  };

  const handleSignOut = async () => {
    // Nothing to sign out of in local mode, and Amplify was never configured.
    if (!LOCAL_MODE) {
      await amplifySignOut();
    }
    clearAuthHeadersCache();
    setUser(null);
    setUserAttributes(null);
    setUserGroups([]);
    setIsFederated(false);
    setIsAuthenticated(false);
  };

  const getIdToken = async (): Promise<string | null> => {
    if (LOCAL_MODE) return null;
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        user,
        userAttributes,
        name,
        userGroups,
        isFederated,
        isAdmin,
        isUser,
        signInWithSso: handleSignInWithSso,
        signOut: handleSignOut,
        getIdToken,
      }}
    >
      {isLoading ? (
        <div className='flex min-h-screen flex-col items-center justify-center gap-5 bg-canvas'>
          <BrandLogo />
          <Spinner size='lg' />
          <div className='text-[15px] font-medium text-ink-3'>Checking your session…</div>
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
