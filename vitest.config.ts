// Default config = the unit suite, so a bare `vitest` does something useful.
// The database acceptance suite has its own config (vitest.db.config.ts)
// because it needs a global setup and must not run in parallel.
export { default } from './vitest.unit.config'
