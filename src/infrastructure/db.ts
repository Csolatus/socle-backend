import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import * as schema from '#/infrastructure/schema.ts'

export const defaultDatabaseUrl =
  'postgres://events:events@localhost:55432/events'

export function createDatabase(url = defaultDatabaseUrl) {
  const sql = new SQL(url)
  return { sql, db: drizzle({ client: sql, schema }) }
}

export type Database = ReturnType<typeof createDatabase>['db']
