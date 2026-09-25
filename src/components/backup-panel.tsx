'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { downloadEncryptedBackup } from '@/lib/backup/download';
import { MIN_BACKUP_PASSWORD_LENGTH, RESTORE_CONFIRMATION_WORD } from '@/lib/backup/policy';

interface DocumentsStatusView {
  referenced: number;
  presentOnDisk: number;
  missing: string[];
  orphans: string[];
}

/**
 * Backup and restore (SPEC §18.3–18.4, blueprint §6). Two things a household
 * must be able to do without an agent: take an encrypted archive away, and put
 * one back. Both are deliberately plain, with the consequences spelled out —
 * the recovery password is never stored anywhere, and a restore replaces the
 * current data.
 */
export function BackupPanel({
  appVersion,
  documentsStatus,
}: {
  appVersion: string;
  documentsStatus: DocumentsStatusView;
}) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [downloadState, setDownloadState] = useState<{
    kind: 'idle' | 'ok' | 'error';
    message: string | null;
  }>({
    kind: 'idle',
    message: null,
  });
  const [busy, setBusy] = useState(false);

  const [restorePassword, setRestorePassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [archive, setArchive] = useState<File | null>(null);
  const [restoreState, setRestoreState] = useState<{
    kind: 'idle' | 'ok' | 'error';
    message: string | null;
  }>({ kind: 'idle', message: null });
  const [restoring, setRestoring] = useState(false);

  async function handleDownload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDownloadState({ kind: 'idle', message: null });
    if (password.length < MIN_BACKUP_PASSWORD_LENGTH) {
      setDownloadState({
        kind: 'error',
        message: `Use a passphrase of at least ${MIN_BACKUP_PASSWORD_LENGTH} characters.`,
      });
      return;
    }
    if (password !== repeat) {
      setDownloadState({ kind: 'error', message: 'The two passphrases are different.' });
      return;
    }
    setBusy(true);
    try {
      const result = await downloadEncryptedBackup(password, appVersion);
      setDownloadState({
        kind: 'ok',
        message: `Saved ${result.filename} (${Math.round(result.bytes / 1024)} KB)${
          result.usedFallback ? ' — named locally because the server sent no filename' : ''
        }. Keep it somewhere you can reach if this server dies, and remember the passphrase: it is not stored anywhere.`,
      });
      setPassword('');
      setRepeat('');
    } catch (err) {
      setDownloadState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'The backup could not be created.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRestoreState({ kind: 'idle', message: null });
    if (archive === null) {
      setRestoreState({ kind: 'error', message: 'Choose a backup archive first.' });
      return;
    }
    if (restorePassword.length === 0) {
      setRestoreState({
        kind: 'error',
        message: 'Enter the passphrase that archive was made with.',
      });
      return;
    }
    if (confirmation.trim().toUpperCase() !== RESTORE_CONFIRMATION_WORD) {
      setRestoreState({ kind: 'error', message: `Type ${RESTORE_CONFIRMATION_WORD} to confirm.` });
      return;
    }
    setRestoring(true);
    try {
      const body = new FormData();
      body.set('archive', archive);
      body.set('password', restorePassword);
      body.set('confirm', confirmation);
      const response = await fetch('/api/restore', { method: 'POST', body, cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        counts?: Record<string, number>;
        documentsRestored?: number;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? `The restore failed (HTTP ${response.status}).`);
      }
      setRestoreState({
        kind: 'ok',
        message: `Restored ${payload.counts?.purchases ?? 0} purchases, ${
          payload.counts?.checkpoints ?? 0
        } checkpoints and ${payload.documentsRestored ?? 0} attachments. Everything before it is preserved on disk under a .pre-restore name.`,
      });
      setArchive(null);
      setRestorePassword('');
      setConfirmation('');
      // The running pages must read the restored data.
      router.refresh();
    } catch (err) {
      setRestoreState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'The restore failed.',
      });
    } finally {
      setRestoring(false);
    }
  }

  const statusLine =
    documentsStatus.missing.length > 0
      ? `${documentsStatus.missing.length} attachment file(s) are referenced but missing — take a backup to see the exact names, and check the container's documents folder.`
      : documentsStatus.orphans.length > 0
        ? `${documentsStatus.referenced} attachments stored; ${documentsStatus.orphans.length} file(s) in the documents folder are unreferenced (kept, never deleted, and left out of archives).`
        : `${documentsStatus.referenced} attachment(s) stored and accounted for.`;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <h3 className="text-lg font-semibold">Download a backup</h3>
          <p className="mt-1 text-xs text-ink-soft">
            An encrypted archive of the database <em>and</em> every attached receipt or invoice,
            with a checksum manifest. The passphrase is used in memory only — it is never written to
            disk or logged. Lose it and the archive is unreadable, by design.
          </p>
          <form onSubmit={handleDownload} className="mt-3 space-y-2">
            <label className="block text-xs font-medium text-ink-soft">
              Backup passphrase ({MIN_BACKUP_PASSWORD_LENGTH}+ characters)
              <input
                type="password"
                name="backup-password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded border border-border-strong px-2 py-1 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-ink-soft">
              Repeat passphrase
              <input
                type="password"
                name="backup-password-repeat"
                autoComplete="new-password"
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
                className="w-full rounded border border-border-strong px-2 py-1 text-sm"
              />
            </label>
            <button
              type="submit"
              name="download-backup"
              disabled={busy}
              className="rounded bg-till px-3 py-1.5 text-sm font-medium text-till-ink disabled:opacity-60"
            >
              {busy ? 'Encrypting…' : 'Download encrypted backup'}
            </button>
            {downloadState.message !== null ? (
              <p
                role="status"
                className={`text-xs ${downloadState.kind === 'error' ? 'text-danger' : 'text-positive'}`}
              >
                {downloadState.message}
              </p>
            ) : null}
          </form>
          <p className="mt-3 text-xs text-ink-muted">
            Nothing is uploaded anywhere and no schedule is implied: save the file where you keep
            important documents, and repeat this by hand whenever you want a fresher copy.
          </p>
        </section>

        <section className="rounded-xl border border-danger-200 bg-surface p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-danger-800">Restore a backup</h3>
          <p className="mt-1 text-xs text-ink-soft">
            This <strong>replaces everything</strong> in this installation — pots, purchases,
            schedules, settings and attachments — with the contents of the archive. The previous
            database and documents are moved aside (never deleted) under a{' '}
            <code>.pre-restore-…</code> name, and the app reconnects to the restored data
            immediately. Take a fresh backup first if the current data matters.
          </p>
          <form onSubmit={handleRestore} className="mt-3 space-y-2">
            <label className="block text-xs font-medium text-ink-soft">
              Archive file
              <input
                type="file"
                name="restore-archive"
                accept=".simple-finance-backup,application/octet-stream"
                onChange={(event) => setArchive(event.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-xs"
              />
            </label>
            <label className="block text-xs font-medium text-ink-soft">
              Passphrase that archive was made with
              <input
                type="password"
                name="restore-password"
                autoComplete="off"
                value={restorePassword}
                onChange={(event) => setRestorePassword(event.target.value)}
                className="w-full rounded border border-border-strong px-2 py-1 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-ink-soft">
              Type {RESTORE_CONFIRMATION_WORD} to confirm
              <input
                name="restore-confirm"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                className="w-full rounded border border-border-strong px-2 py-1 text-sm"
              />
            </label>
            <button
              type="submit"
              name="restore-backup"
              disabled={restoring}
              className="rounded bg-danger-800 px-3 py-1.5 text-sm font-medium text-till-ink disabled:opacity-60"
            >
              {restoring ? 'Restoring…' : 'Replace this installation from the archive'}
            </button>
            {restoreState.message !== null ? (
              <p
                role="status"
                className={`text-xs ${restoreState.kind === 'error' ? 'text-danger' : 'text-positive'}`}
              >
                {restoreState.message}
              </p>
            ) : null}
          </form>
        </section>
      </div>
      <p className="text-xs text-ink-muted">{statusLine}</p>
    </div>
  );
}
