import { fileURLToPath } from 'node:url'
import { createDatabase } from '#/infrastructure/db.ts'

const { sql } = createDatabase(process.env.DATABASE_URL)
try {
  await sql.file(fileURLToPath(new URL('../sql/seed.sql', import.meta.url)))
  console.log('Seed applied')
} finally {
  await sql.close()
}
