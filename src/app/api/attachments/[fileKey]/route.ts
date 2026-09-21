import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getDbHandle } from '@/lib/db/client';
import { loadAppConfig } from '@/lib/config';
import { attachments } from '@/lib/db/schema';
import {
  isSafeFileKey,
  readAttachmentBytes,
  sanitizeOriginalName,
} from '@/lib/records/attachments';

/**
 * Authenticated attachment viewer (SPEC §23.2). Guarded independently of any
 * page (blueprint §4.4), responses private and uncached, `Content-Disposition`
 * built from a sanitized display name while the file itself is addressed by
 * the server-generated key — a key that is validated against the same pattern
 * the backup engine and the restore path use, so no request can reach outside
 * `documents/`.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ fileKey: string }> }) {
  // Route handlers guard themselves from the Request, not from a page context
  // (src/lib/auth/next.ts documents why — this is the same verification path).
  const user = await getCurrentUser(request.headers, loadAppConfig());
  if (user === null) return new Response('Unauthorized', { status: 401 });

  const { fileKey } = await params;
  if (!isSafeFileKey(fileKey)) return new Response('Not found', { status: 404 });

  const row = getDbHandle()
    .db.select()
    .from(attachments)
    .where(eq(attachments.fileKey, fileKey))
    .get();
  if (row === undefined || row.state !== 'stored') {
    return new Response('Not found', { status: 404 });
  }

  try {
    const body = await readAttachmentBytes(loadAppConfig().documentsDir, row.fileKey);
    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': row.mime,
        'Content-Length': String(body.byteLength),
        // `inline` so a receipt photo opens in the viewer; the name is
        // sanitized and only ever used for display/download naming.
        'Content-Disposition': `inline; filename="${sanitizeOriginalName(row.originalName)}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
