import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { createDatabase } from '#/infrastructure/db.ts'

const { sql, db } = createDatabase(process.env.DATABASE_URL)
try {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  })
  console.log('Migrations applied')
} finally {
  await sql.close()
}
