/**
 * DuckDB access layer.
 *
 * DuckDB is used for large-scale Parquet filtering (the Overture places
 * dataset and local fixtures) without downloading anything into Postgres.
 * A single in-memory DuckDB instance is shared; queries are parameterized.
 */
import { DuckDBConnection, DuckDBInstance, type DuckDBValue } from '@duckdb/node-api';

let instancePromise: Promise<DuckDBInstance> | null = null;
let connectionPromise: Promise<DuckDBConnection> | null = null;

export class DuckDbError extends Error {
  constructor(
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'DuckDbError';
  }
}

export interface DuckRow {
  [column: string]: unknown;
}

async function getInstance(): Promise<DuckDBInstance> {
  if (!instancePromise) {
    instancePromise = DuckDBInstance.create(':memory:').catch((err) => {
      instancePromise = null;
      throw new DuckDbError('DuckDB could not be initialized', String(err));
    });
  }
  return instancePromise;
}

export async function getConnection(): Promise<DuckDBConnection> {
  if (!connectionPromise) {
    connectionPromise = getInstance().then((i) => i.connect());
  }
  return connectionPromise;
}

/** Ensure the httpfs extension is available (needed for remote https/S3 parquet). */
export async function ensureHttpFs(conn: DuckDBConnection): Promise<void> {
  try {
    await conn.run('LOAD httpfs');
  } catch {
    try {
      await conn.run('INSTALL httpfs');
      await conn.run('LOAD httpfs');
    } catch (err) {
      throw new DuckDbError(
        'DuckDB httpfs extension could not be loaded — remote data sources are unavailable in this environment.',
        String(err),
      );
    }
  }
  try {
    await conn.run("SET s3_region='us-west-2'");
  } catch {
    // non-fatal; only relevant for S3 sources
  }
}

/**
 * Run a query and return plain JS row objects.
 * Values are passed as prepared-statement parameters.
 */
export async function queryRows(
  sqlText: string,
  params: DuckDBValue[] = [],
): Promise<DuckRow[]> {
  const conn = await getConnection();
  try {
    const reader = await conn.runAndReadAll(sqlText, params);
    return reader.getRowObjectsJson() as DuckRow[];
  } catch (err) {
    throw new DuckDbError(`DuckDB query failed: ${(err as Error).message}`, String(err));
  }
}

/** Inline a string safely into DuckDB SQL (for table-function path arguments,
 * which cannot always be parameterized). Escapes single quotes. */
export function duckStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
