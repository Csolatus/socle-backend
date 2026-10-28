import { SQL } from 'bun'
import { fileURLToPath } from 'node:url'

const sql = new SQL(
  process.env.DATABASE_URL ?? 'postgres://events:events@localhost:55432/events',
)
try {
  await sql.file(fileURLToPath(new URL('../sql/seed.sql', import.meta.url)))
  console.log('Seed applied')
} finally {
  await sql.close()
}
