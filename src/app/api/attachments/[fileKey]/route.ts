import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { currentUserFromRequest } from '@/lib/auth/next';
import { getDbHandle } from '@/lib/db/client';
import { attachments } from '@/lib/db/schema';
import { loadAppConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ fileKey: string }> }) {
  if (!(await currentUserFromRequest())) return new Response('Unauthorized', { status: 401 });
  const { fileKey } = await params;
  if (!/^[a-f0-9-]+\.(?:png|jpe?g|pdf)$/i.test(fileKey))
    return new Response('Not found', { status: 404 });
  const row = getDbHandle()
    .db.select()
    .from(attachments)
    .where(eq(attachments.fileKey, fileKey))
    .get();
  if (!row || row.state !== 'stored') return new Response('Not found', { status: 404 });
  try {
    const body = await readFile(
      path.join(path.dirname(loadAppConfig().databasePath), 'documents', row.fileKey),
    );
    return new Response(body, {
      headers: {
        'Content-Type': row.mime,
        'Content-Length': String(body.byteLength),
        'Content-Disposition': `inline; filename="${row.originalName.replace(/["\\\r\n]/g, '_')}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
