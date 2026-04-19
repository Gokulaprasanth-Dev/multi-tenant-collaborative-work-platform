// frontend/src/app/core/models/user.model.ts

export interface UserPreferences {
  timezone:   string;
  locale:     string;
  theme:      'dark' | 'light' | 'system';
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
}

export interface User {
  id:            string;
  email:         string;
  name:          string;
  bio:           string | null;
  avatarUrl:     string | null;
  emailVerified: boolean;
  mfaEnabled:    boolean;
  role:          'member' | 'admin' | 'platform_admin';
  preferences:   UserPreferences;
  createdAt:     string;
}

export interface UserDto {
  id:             string;
  email:          string;
  name:           string;
  bio:            string | null;
  avatar_url:     string | null;
  email_verified: boolean;
  mfa_enabled:    boolean;
  role:           'member' | 'admin' | 'platform_admin';
  preferences:    UserPreferences | null;
  created_at:     string;
}

export interface Session {
  id:         string;
  deviceInfo: string;
  ipAddress:  string;
  lastActive: string;
  isCurrent:  boolean;
}

export interface MfaStatus {
  enabled:              boolean;
  backupCodesRemaining: number;
}

export function defaultPreferences(): UserPreferences {
  return { timezone: 'UTC', locale: 'en-US', theme: 'dark', dateFormat: 'DD/MM/YYYY' };
}

export function toUser(dto: UserDto): User {
  return {
    id:            dto.id,
    email:         dto.email,
    name:          dto.name,
    bio:           dto.bio,
    avatarUrl:     dto.avatar_url,
    emailVerified: dto.email_verified,
    mfaEnabled:    dto.mfa_enabled,
    role:          dto.role,
    preferences:   dto.preferences ?? defaultPreferences(),
    createdAt:     dto.created_at,
  };
}
