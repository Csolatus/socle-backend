import { Hono } from 'hono'
import { StreamableHTTPTransport } from '@hono/mcp'
import type { Services } from '#/application/services.ts'
import { requestUser } from '#/request.ts'
import { Option } from '#/shared-kernel/option.ts'
import { createMcpServer } from '#/mcp/server.ts'

// Keep request-local server/identity alive until the HTTP response is consumed.
function closeAfterResponse(
  response: Response,
  close: () => Promise<void>,
): Response {
  if (!response.body) {
    void close()
    return response
  }
  const reader = response.body.getReader()
  return new Response(
    new ReadableStream({
      async pull(controller) {
        try {
          const chunk = await reader.read()
          if (chunk.done) {
            await close()
            controller.close()
          } else {
            controller.enqueue(chunk.value)
          }
        } catch (error) {
          await close()
          controller.error(error)
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason)
        } finally {
          await close()
        }
      },
    }),
    { status: response.status, headers: response.headers },
  )
}

export function mcpRoutes(services: Services) {
  const routes = new Hono()
  routes.all('/mcp', async (c) => {
    if (c.req.method !== 'POST') {
      c.header('Allow', 'POST')
      return c.json(
        { error: 'This stateless MCP endpoint supports POST only' },
        405,
      )
    }
    const origin = c.req.header('Origin')
    if (
      origin &&
      !['http://localhost:3000', 'http://127.0.0.1:3000'].includes(origin)
    ) {
      return c.json({ error: 'Origin not allowed' }, 403)
    }
    const header = c.req.header('X-User-Id')
    const currentUser = () =>
      requestUser(services.identity, Option.fromNullable(header))
    // Stateless Streamable HTTP: no session map and no user identity shared between requests.
    const server = createMcpServer(services, currentUser)
    const transport = new StreamableHTTPTransport({
      sessionIdGenerator: undefined,
      strictAcceptHeader: true,
    })
    await server.connect(transport)
    try {
      const response = await transport.handleRequest(c)
      if (!response) {
        await server.close()
        return c.body(null, 204)
      }
      return closeAfterResponse(response, () => server.close())
    } catch (error) {
      await server.close()
      throw error
    }
  })
  return routes
}
