import type { Prisma, Role } from '../generated/prisma/client.js';

/** The authenticated user attached to `req.user`, always loaded from the database (never from token claims). */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
}

export const authUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
} satisfies Prisma.UserSelect;

/** Public shape returned to clients. */
export const toPublicUser = ({ id, email, name, role }: AuthUser) => ({ id, email, name, role });
