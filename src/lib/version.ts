/**
 * Single source of truth for the application identity and version.
 *
 * Blueprint §10: one client-safe version module; package.json and the
 * lockfile root metadata must stay aligned (checked by tests/version.test.ts).
 * v0.1.0 is the first planned release (end of Phase 5); until then the app
 * identifies as a pre-release build.
 */
export const APP_NAME = 'Simple Finance';

export const APP_VERSION = '0.1.1';

export const APP_RELEASE_STAGE = 'pre-release';
