import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { McpError } from '@modelcontextprotocol/sdk/types.js'
import type { Services } from '#/application/services.ts'
import type { ApplicationError } from '#/application/ports.ts'
import type { UserId } from '#/domain/ids.ts'
import { presentError } from '#/presentation/event-presenter.ts'
import { presentApplicationError } from '#/presentation/application-error.ts'
import { Result } from '#/shared-kernel/result.ts'
import { createTools } from '#/mcp/tools.ts'

export function createMcpServer(
  services: Services,
  currentUser: () => Promise<Result<UserId, ApplicationError>>,
) {
  const server = new McpServer({ name: 'events-day2', version: '1.0.0' })
  for (const tool of createTools(services, currentUser)) {
    const { name, description, annotations } = tool.definition
    // The SDK takes Zod schemas. Valibot remains the source; this bridge only
    // adapts its generated JSON Schema to the SDK registration API.
    server.registerTool(
      name,
      {
        description,
        annotations,
        ...tool.registration,
      },
      async (input) => {
        const execution = await Result.tryPromise(
          () => tool.call(input),
          (cause) => {
            console.error(cause)
            return presentError(
              'INTERNAL_ERROR',
              'An unexpected error occurred',
            )
          },
        )
        if (execution._tag === 'Failure') {
          return toolFailure(execution.error)
        }
        const result = execution.value
        if (result._tag === 'Success') {
          return {
            content: [{ type: 'text', text: JSON.stringify(result.value) }],
            structuredContent: result.value,
          }
        }
        const body =
          result.error instanceof McpError
            ? presentError('INVALID_INPUT', result.error.message)
            : presentApplicationError(result.error).body
        return toolFailure(body)
      },
    )
  }
  return server
}
function toolFailure(body: ReturnType<typeof presentError>) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify(body) }],
  }
}
