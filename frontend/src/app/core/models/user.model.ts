// frontend/src/app/core/models/user.model.ts
export interface User {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  role: 'member' | 'admin' | 'platform_admin';
  createdAt: string;
}
