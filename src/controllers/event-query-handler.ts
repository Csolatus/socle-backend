import type { Context } from 'hono'
import type { Services } from '#/application/services.ts'
import type { EventFilter } from '#/application/ports.ts'
import type { EventId } from '#/domain/ids.ts'
import { httpResult } from '#/controllers/http-result.ts'
import { presentEvent } from '#/presentation/event-presenter.ts'

// HTTP reads. Only ReadEvents is reachable here, never a command use case.
export function createEventQueryHandler({ read }: Pick<Services, 'read'>) {
  return {
    list: async (context: Context, filter: EventFilter) =>
      context.json((await read.list(filter)).map(presentEvent)),
    get: async (context: Context, id: EventId) =>
      httpResult(context, await read.get(id), presentEvent),
  }
}
export type EventQueryHandler = ReturnType<typeof createEventQueryHandler>
