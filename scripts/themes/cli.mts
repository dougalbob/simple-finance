/**
 * `npm run themes:build` / `npm run themes:check` (decision 160).
 *
 * A `.mts` wrapper only because the repository is CommonJS by default and the
 * generator wants top-level await; all the work is in `build.ts`, which
 * `tsc --noEmit` and `tests/themes.test.ts` both see.
 */
import { main } from './build';

await main(process.argv.includes('--check'));
