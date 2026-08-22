// Standard Cognito User Attributes
export interface StandardUserAttributes {
  email?: string;
  given_name?: string; // Cognito API uses given_name (snake_case)
  family_name?: string; // Cognito API uses family_name (snake_case)
}

// Complete User Attributes as stored in Cognito.
export type UserAttributes = StandardUserAttributes;

// User Profile (for frontend use - more user-friendly names)
export interface UserProfile {
  email: string;
  fullName: string; // Frontend combines given_name + family_name
  firstName: string; // Maps to given_name
  lastName: string; // Maps to family_name
}

// Utility Functions for Attribute Conversion
export class UserAttributeUtils {
  /**
   * Convert Cognito attributes to UserProfile format
   */
  static cognitoToProfile(attributes: UserAttributes): UserProfile {
    return {
      email: attributes.email || '',
      fullName: [attributes.given_name, attributes.family_name].filter(Boolean).join(' '),
      firstName: attributes.given_name || '',
      lastName: attributes.family_name || '',
    };
  }
}
