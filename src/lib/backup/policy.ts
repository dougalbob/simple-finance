/**
 * Backup/restore policy constants (SPEC §18.3–18.4), kept in their own
 * client-safe module so the Settings UI, the boundary schemas and the API
 * routes cannot disagree about the rules they are telling the user about.
 */

/**
 * Minimum length for the passphrase protecting a NEW archive. Restoring
 * accepts any non-empty password: an archive made before this rule must stay
 * recoverable.
 */
export const MIN_BACKUP_PASSWORD_LENGTH = 12;

/** The typed confirmation for the destructive in-place restore. */
export const RESTORE_CONFIRMATION_WORD = 'RESTORE';

/**
 * Bounded upload for a restore: an archive is a database plus documents, not
 * an ISO image. Enforced on the declared length and on the received file.
 */
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
