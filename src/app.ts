import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { createEventController } from '#/controllers/event-controller.ts'
import { createUserController } from '#/controllers/user-controller.ts'
import { userRoutes } from '#/routes/user-routes.ts'
import type { Services } from '#/application/services.ts'
import { mcpRoutes } from '#/mcp/routes.ts'
import { chatRoutes, type ChatOptions } from '#/chat/routes.ts'
import { chatUiRoutes } from '#/chat/ui.ts'
import { eventRoutes } from '#/routes/event-routes.ts'
import { presentError } from '#/presentation/event-presenter.ts'

export function createApp(services: Services, chatOptions: ChatOptions) {
  const app = new Hono()
  app.route('/', eventRoutes(createEventController(services)))
  app.route('/', userRoutes(createUserController(services)))
  app.route('/', mcpRoutes(services))
  app.route('/', chatRoutes(services, chatOptions))
  app.route('/', chatUiRoutes())
  app.notFound((c) => c.json(presentError('NOT_FOUND', 'Route not found'), 404))
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return error.getResponse()
    }
    console.error(error)
    return c.json(
      presentError('INTERNAL_ERROR', 'An unexpected error occurred'),
      500,
    )
  })
  return app
}
