import { Hono } from 'hono'
import * as v from 'valibot'
import type { AnyTextAdapter } from '@tanstack/ai'
import { createMCPClient } from '@tanstack/ai-mcp'
import type { Services } from '#/application/services.ts'
import { httpFailure } from '#/controllers/http-result.ts'
import { requestJson, requestUser } from '#/request.ts'
import { presentError } from '#/presentation/event-presenter.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import { openRouterAdapter } from '#/chat/provider.ts'
import { chatResponse } from '#/chat/run.ts'

export interface ChatOptions {
  // Trusted configuration, never derived from a Host header or request body.
  mcpUrl: () => string
  adapter?: () => AnyTextAdapter
}
const requestSchema = v.strictObject({
  message: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(4000)),
})

export function chatRoutes(services: Services, options: ChatOptions) {
  const routes = new Hono()
  routes.post('/chat', async (c) => {
    const user = await requestUser(
      services.identity,
      Option.fromNullable(c.req.header('X-User-Id')),
    )
    if (user._tag === 'Failure') {
      return httpFailure(c, user.error)
    }
    const input = await requestJson(c.req.raw, requestSchema)
    if (input._tag === 'Failure') {
      return httpFailure(c, input.error)
    }
    const adapter = options.adapter
      ? Result.succeed(options.adapter())
      : openRouterAdapter()
    if (adapter._tag === 'Failure') {
      return c.json(
        presentError(
          'AI_NOT_CONFIGURED',
          'Set OPENROUTER_API_KEY to enable chat. MCP works without it.',
        ),
        503,
      )
    }
    const connection = await Result.tryPromise(
      () =>
        createMCPClient({
          transport: {
            type: 'http',
            url: options.mcpUrl(),
            headers: { 'X-User-Id': user.value },
          },
        }),
      (cause) => {
        console.error(cause)
        return presentError(
          'MCP_UNAVAILABLE',
          'Unable to connect to the MCP server',
        )
      },
    )
    if (connection._tag === 'Failure') {
      return c.json(connection.error, 502)
    }
    return chatResponse({
      adapter: adapter.value,
      mcp: connection.value,
      message: input.value.message,
      signal: c.req.raw.signal,
    })
  })
  return routes
}
