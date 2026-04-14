/**
 * Ambient module shims for optional dependencies.
 *
 * These provide minimal type surface for modules that are not always
 * present in the install tree (e.g. better-sqlite3 which is installed
 * only for certain runtime builds). Keeping the shims here lets
 * `tsc --noEmit` pass in any environment while preserving real types
 * when the package is actually installed.
 */

declare module "better-sqlite3" {
  export interface Statement {
    run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    iterate(...params: unknown[]): IterableIterator<unknown>;
    finalize(): void;
    [extra: string]: unknown;
  }

  export interface Database {
    prepare(source: string): Statement;
    exec(source: string): Database;
    close(): void;
    transaction<T extends (...args: any[]) => any>(fn: T): T;
    pragma(source: string, options?: { simple?: boolean }): unknown;
    [extra: string]: unknown;
  }

  export interface DatabaseConstructor {
    new (filename: string, options?: Record<string, unknown>): Database;
    (filename: string, options?: Record<string, unknown>): Database;
  }

  const Database: DatabaseConstructor;
  export default Database;
}

