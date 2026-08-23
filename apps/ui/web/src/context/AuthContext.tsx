import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

interface AuthContextType {
  user: LocalUser;
  userAttributes: Record<string, string>;
  name: string;
}

interface LocalUser {
  username: string;
  userId: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// The app runs on one machine for one person, so there is no user pool to ask and
// nothing to sign in to. This is the identity the profile page and the assistant's
// greeting read; it stays here rather than being inlined at each call site so those
// consumers keep the shape they already expect.
const LOCAL_USER: LocalUser = { username: 'local', userId: 'local' };
const LOCAL_ATTRIBUTES: Record<string, string> = {
  email: 'local@localhost',
  given_name: 'Local',
  family_name: 'User',
};

const LOCAL_NAME = `${LOCAL_ATTRIBUTES.given_name} ${LOCAL_ATTRIBUTES.family_name}`.trim();

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider
      value={{ user: LOCAL_USER, userAttributes: LOCAL_ATTRIBUTES, name: LOCAL_NAME }}
    >
      {children}
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
