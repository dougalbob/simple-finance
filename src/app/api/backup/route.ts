import { getCurrentUser } from '@/lib/auth/current-user';
import { createEncryptedBackup } from '@/lib/backup/backup';
import { loadAppConfig } from '@/lib/config';
import { getDbHandle } from '@/lib/db/client';
import { APP_VERSION } from '@/lib/version';
import { backupPasswordSchema } from '@/lib/validation';
import { z } from 'zod';

/**
 * Encrypted backup download (Phase 1 skeleton; full contract in Phase 5).
 * The archive is encrypted in-process with the caller-supplied password,
 * which is never persisted. The filename follows the versioned contract
 * (SPEC §18.3) and is carried via Content-Disposition — clients must forward
 * it into any blob download (blueprint §6).
 */
const bodySchema = z.object({ password: backupPasswordSchema });

export async function POST(request: Request) {
  const config = loadAppConfig();
  const user = await getCurrentUser(request.headers, config);
  if (user === null) {
    return Response.json({ error: 'unauthorised' }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'a backup password is required' }, { status: 400 });
  }

  const backup = await createEncryptedBackup({
    handle: getDbHandle(config),
    password: parsed.data.password,
    appVersion: APP_VERSION,
  });

  return new Response(new Uint8Array(backup.bytes), {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(backup.bytes.length),
      'content-disposition': `attachment; filename="${backup.filename}"`,
      'cache-control': 'no-store',
    },
  });
}
