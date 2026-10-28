import { SQL } from 'bun'
import { createApp } from '#/app.ts'
import { createServices } from '#/application/services.ts'
import { PostgresEventRepository } from '#/infrastructure/postgres-event-repository.ts'

const sql = new SQL(
  process.env.DATABASE_URL ?? 'postgres://events:events@localhost:55432/events',
)
const repository = new PostgresEventRepository(sql)
const services = createServices(repository)
const port = Number(process.env.PORT ?? 3000)
const app = createApp(services, {
  mcpUrl: () => process.env.MCP_URL ?? `http://127.0.0.1:${port}/mcp`,
})
const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch: app.fetch,
})
console.log(`Events API listening on ${server.url}`)

async function shutdown() {
  await server.stop()
  await sql.close()
  process.exit(0)
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
