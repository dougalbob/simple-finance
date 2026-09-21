import { getCurrentUser } from '@/lib/auth/current-user';
import { isSameOriginRequest } from '@/lib/auth/origin';
import { createEncryptedBackup, BackupIncompleteError } from '@/lib/backup/backup';
import { loadAppConfig } from '@/lib/config';
import { getDbHandle } from '@/lib/db/client';
import { APP_VERSION } from '@/lib/version';
import { backupPasswordCreateSchema } from '@/lib/validation';

/**
 * Encrypted backup download (SPEC §18.2–18.3).
 *
 * The archive contains the WAL-consistent database snapshot plus every
 * attachment the snapshot references, with a sha256 manifest, encrypted
 * in-process with the caller-supplied password. The password is never
 * persisted. The filename follows the versioned contract and is carried via
 * `Content-Disposition` — the client must forward it into any blob download
 * (blueprint §6), which `lib/backup/download.ts` does.
 */
export async function POST(request: Request) {
  const config = loadAppConfig();
  const user = await getCurrentUser(request.headers, config);
  if (user === null) {
    return Response.json({ error: 'unauthorised' }, { status: 401 });
  }
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: 'cross-origin backup request rejected' }, { status: 403 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = backupPasswordCreateSchema.safeParse(
    (body as { password?: unknown } | null)?.password,
  );
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? 'A backup password of at least 12 characters is required';
    return Response.json({ error: message }, { status: 400 });
  }

  try {
    const backup = await createEncryptedBackup({
      handle: getDbHandle(config),
      password: parsed.data,
      appVersion: APP_VERSION,
      documentsDir: config.documentsDir,
    });

    return new Response(new Uint8Array(backup.bytes), {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(backup.bytes.length),
        'content-disposition': `attachment; filename="${backup.filename}"`,
        'cache-control': 'no-store',
        'x-backup-documents': String(backup.manifest.documents.included),
        'x-backup-orphans': String(backup.manifest.documents.orphans.length),
      },
    });
  } catch (err) {
    if (err instanceof BackupIncompleteError) {
      // Honest failure: an archive that would be missing a referenced receipt
      // is never produced (SPEC §18.2).
      return Response.json({ error: err.message }, { status: 409 });
    }
    return Response.json(
      { error: 'The backup could not be created. Check the container logs.' },
      { status: 500 },
    );
  }
}
