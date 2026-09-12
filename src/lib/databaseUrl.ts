const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Host name of a Postgres connection string ('' if it can't be parsed). */
export function databaseHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** True for a database on this machine (Docker, `prisma dev`): the only kind scripts may wipe by default. */
export const isLocalDatabase = (url: string): boolean => LOCAL_HOSTS.has(databaseHost(url));
