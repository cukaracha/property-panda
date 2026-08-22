import { authFetch } from './authUtils';

const API_URL = import.meta.env.VITE_API_URL;

export interface SignupResponse {
  message: string;
}

// Public — request an account. The backend validates the email domain and, if
// approved, emails a temporary password.
export const requestSignup = async (email: string): Promise<SignupResponse> => {
  const response = await fetch(`${API_URL}/users/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Signup request failed');
  }

  return data;
};

// ---------------------------------------------------------------------------
// Admin user management (Cognito-authorized; the API Gateway authorizer returns
// a 403 with { error, message } for non-admins — data.message is surfaced).
// ---------------------------------------------------------------------------

export interface CognitoUser {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  enabled: boolean;
  created: string;
  groups: string[];
}

export interface ListUsersResponse {
  users: CognitoUser[];
  paginationToken?: string;
}

export interface AdminMessageResponse {
  message: string;
}

export const listUsers = async (
  limit?: number,
  paginationToken?: string,
  groupFilter?: string
): Promise<ListUsersResponse> => {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (paginationToken) params.set('paginationToken', paginationToken);
  if (groupFilter) params.set('groupFilter', groupFilter);

  const query = params.toString();
  const url = `${API_URL}/admin/users${query ? `?${query}` : ''}`;

  const response = await authFetch(url);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Failed to list users');
  }

  return data;
};

export const createUser = async (
  email: string,
  firstName?: string,
  lastName?: string,
  group?: string
): Promise<AdminMessageResponse> => {
  const response = await authFetch(`${API_URL}/admin/users`, {
    method: 'POST',
    body: JSON.stringify({ email, firstName, lastName, group }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Failed to create user');
  }

  return data;
};

export const updateUser = async (
  username: string,
  attributes?: { firstName?: string; lastName?: string },
  group?: string
): Promise<AdminMessageResponse> => {
  const response = await authFetch(`${API_URL}/admin/users`, {
    method: 'PUT',
    body: JSON.stringify({ username, attributes, group }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Failed to update user');
  }

  return data;
};

export const deleteUser = async (username: string): Promise<AdminMessageResponse> => {
  const params = new URLSearchParams({ username });
  const response = await authFetch(`${API_URL}/admin/users?${params}`, {
    method: 'DELETE',
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Failed to delete user');
  }

  return data;
};
