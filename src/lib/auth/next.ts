import { headers } from 'next/headers';
import { loadAppConfig } from '../config';
import { getCurrentUser, type User } from './current-user';

/**
 * Next.js adapter: resolve the signed-in user inside server components and
 * server actions. Route handlers receive a Request and should call
 * getCurrentUser(request.headers, loadAppConfig()) directly — every entry
 * point guards itself (blueprint §4.4).
 */
export async function currentUserFromRequest(): Promise<User | null> {
  return getCurrentUser(await headers(), loadAppConfig());
}
