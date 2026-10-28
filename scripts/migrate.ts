import { SQL } from 'bun'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/bun-sql'
import { migrate } from 'drizzle-orm/bun-sql/migrator'

const sql = new SQL(
  process.env.DATABASE_URL ?? 'postgres://events:events@localhost:55432/events',
)
try {
  await migrate(drizzle({ client: sql }), {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  })
  console.log('Migrations applied')
} finally {
  await sql.close()
}
