import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Encryption framing for Simple Finance backup archives
 * (AGENT_APP_BLUEPRINT.md §6, docs/SPEC.md §18.3).
 *
 * Reviewed primitives only: AES-256-GCM with a scrypt-derived key, fresh
 * random salt and nonce per archive. The recovery password is never persisted
 * and never appears in this module's error handling beyond "wrong password or
 * corrupted archive" (a GCM authentication failure cannot distinguish the two,
 * and must not leak more).
 *
 * Frame layout (version 1):
 *   bytes 0-3    magic "SFBA" (ASCII)
 *   byte  4      frame format version (1)
 *   bytes 5-20   scrypt salt (16 bytes)
 *   bytes 21-32  GCM nonce (12 bytes)
 *   bytes 33-N   ciphertext (tar.gz payload)
 *   last 16      GCM auth tag
 */
export const BACKUP_FRAME_MAGIC = 'SFBA';
export const BACKUP_FRAME_VERSION = 1;

const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const KEY_BYTES = 32;

/** Documented, fixed scrypt cost (blueprint §6: review resource limits before changing). */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFormatError';
  }
}

export class BackupPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupPasswordError';
  }
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_BYTES, SCRYPT_PARAMS);
}

export function encryptBackupPayload(plaintext: Buffer, password: string): Buffer {
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const key = deriveKey(password, salt);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([
    Buffer.from(BACKUP_FRAME_MAGIC, 'ascii'),
    Buffer.from([BACKUP_FRAME_VERSION]),
    salt,
    nonce,
    ciphertext,
    tag,
  ]);
}

export function decryptBackupPayload(frame: Buffer, password: string): Buffer {
  const headerLength = 4 + 1 + SALT_BYTES + NONCE_BYTES;
  const minLength = headerLength + GCM_TAG_BYTES;
  if (frame.length < minLength) {
    throw new BackupFormatError('Archive is too short to be a Simple Finance backup');
  }
  const magic = frame.subarray(0, 4).toString('ascii');
  if (magic !== BACKUP_FRAME_MAGIC) {
    throw new BackupFormatError('Not a Simple Finance backup archive');
  }
  const frameVersion = frame[4];
  if (frameVersion !== BACKUP_FRAME_VERSION) {
    throw new BackupFormatError(`Unsupported backup frame version ${frameVersion}`);
  }
  const salt = frame.subarray(5, 5 + SALT_BYTES);
  const nonce = frame.subarray(5 + SALT_BYTES, headerLength);
  const tag = frame.subarray(frame.length - GCM_TAG_BYTES);
  const ciphertext = frame.subarray(headerLength, frame.length - GCM_TAG_BYTES);

  const key = deriveKey(password, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // Authentication failure: wrong password or a modified archive. Both are
    // handled identically and nothing about the failure is persisted.
    throw new BackupPasswordError('Wrong password, or the archive is corrupted');
  }
}
