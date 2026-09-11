import type { Role } from './authStore';

/** Each role's own dashboard: where users land after login and when they open another role's page. */
export const DASHBOARD_PATH: Record<Role, string> = {
  ADMIN: '/admin',
  PROJECT_MANAGER: '/pm',
  DEVELOPER: '/developer',
};

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Admin',
  PROJECT_MANAGER: 'Project manager',
  DEVELOPER: 'Developer',
};
