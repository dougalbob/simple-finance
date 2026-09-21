import { loadAppConfig } from '@/lib/config';
import { getCurrentUser } from '@/lib/auth/current-user';
import { isSameOriginRequest } from '@/lib/auth/origin';
import { restoreLiveInstallation } from '@/lib/backup/live-restore';
import { BackupFormatError, BackupPasswordError } from '@/lib/backup/crypto';
import { RestoreError } from '@/lib/backup/restore';
import { backupPasswordSchema } from '@/lib/validation';
import { MAX_ARCHIVE_BYTES, RESTORE_CONFIRMATION_WORD } from '@/lib/backup/policy';

/**
 * Live in-place restore (SPEC §18.4, blueprint §6 restore contract).
 *
 * Guards, in order and all independent of the UI:
 *   1. authentication (same verification as every other entry point);
 *   2. same-origin check — a route handler is not covered by the framework's
 *      server-action CSRF protection, so it validates the Origin itself;
 *   3. bounded upload size before the body is buffered;
 *   4. an explicit destructive-replacement confirmation word, validated
 *      server-side (the typed confirmation in the UI is assistance, not
 *      authority);
 *   5. password validated by the shared boundary schema.
 *
 * The restore itself is staged and verified before anything is replaced, and
 * preserves the previous database and documents (see lib/backup/restore.ts).
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const config = loadAppConfig();
  const user = await getCurrentUser(request.headers, config);
  if (user === null) {
    return Response.json({ error: 'unauthorised' }, { status: 401 });
  }
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: 'cross-origin restore rejected' }, { status: 403 });
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ARCHIVE_BYTES) {
    return Response.json(
      { error: 'That archive is larger than the 512 MB restore limit.' },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'Expected a multipart form upload' }, { status: 400 });
  }

  const confirmation = String(form.get('confirm') ?? '');
  if (confirmation.trim().toUpperCase() !== RESTORE_CONFIRMATION_WORD) {
    return Response.json(
      { error: `Type ${RESTORE_CONFIRMATION_WORD} to confirm replacing the current data.` },
      { status: 400 },
    );
  }

  const passwordParsed = backupPasswordSchema.safeParse(String(form.get('password') ?? ''));
  if (!passwordParsed.success) {
    return Response.json({ error: 'The archive password is required.' }, { status: 400 });
  }

  const file = form.get('archive');
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: 'Choose a backup archive to restore.' }, { status: 400 });
  }
  if (file.size > MAX_ARCHIVE_BYTES) {
    return Response.json(
      { error: 'That archive is larger than the 512 MB restore limit.' },
      { status: 413 },
    );
  }

  const archive = Buffer.from(await file.arrayBuffer());
  try {
    const result = await restoreLiveInstallation({
      archive,
      password: passwordParsed.data,
      config,
    });
    return Response.json(
      {
        restored: true,
        appVersion: result.restoredAppVersion,
        createdAtLocal: result.manifest.createdAtLocal,
        counts: result.manifest.counts,
        documentsRestored: result.documentsRestored,
        previousPreservedAs: result.previousPreservedAs,
        reopened: result.reopened,
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    if (err instanceof BackupPasswordError) {
      return Response.json(
        { error: 'That password does not open this archive (or the file is damaged).' },
        { status: 400 },
      );
    }
    if (err instanceof BackupFormatError) {
      return Response.json({ error: 'That file is not a Simple Finance backup.' }, { status: 400 });
    }
    if (err instanceof RestoreError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    return Response.json(
      { error: 'The restore failed and the previous data was kept. Check the container logs.' },
      { status: 500 },
    );
  }
}
