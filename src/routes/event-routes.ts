import { Hono } from 'hono'
import type { EventCommandHandler } from '#/controllers/event-command-handler.ts'
import type { EventQueryHandler } from '#/controllers/event-query-handler.ts'
import { httpFailure } from '#/controllers/http-result.ts'
import { requestJson } from '#/request.ts'
import {
  createEventSchema,
  eventFilterSchema,
  parse,
  reservationSchema,
  updateEventSchema,
  eventIdSchema,
  reservationIdSchema,
} from '#/validation.ts'

// Reads go to the query handler, writes to the command handler.
export function eventRoutes(
  queries: EventQueryHandler,
  commands: EventCommandHandler,
) {
  const routes = new Hono()
  routes.get('/events', (c) => {
    const input = parse(eventFilterSchema, c.req.query())
    if (input._tag === 'Failure') {
      return httpFailure(c, input.error)
    }
    return queries.list(c, input.value)
  })
  routes.post('/events', async (c) => {
    const input = await requestJson(c.req.raw, createEventSchema)
    if (input._tag === 'Failure') {
      return httpFailure(c, input.error)
    }
    return commands.create(c, input.value)
  })
  routes.get('/events/:eventId', (c) => {
    const id = parse(eventIdSchema, c.req.param('eventId'))
    if (id._tag === 'Failure') {
      return httpFailure(c, id.error)
    }
    return queries.get(c, id.value)
  })
  routes.patch('/events/:eventId', async (c) => {
    const id = parse(eventIdSchema, c.req.param('eventId'))
    if (id._tag === 'Failure') {
      return httpFailure(c, id.error)
    }
    const patch = await requestJson(c.req.raw, updateEventSchema)
    if (patch._tag === 'Failure') {
      return httpFailure(c, patch.error)
    }
    return commands.update(c, id.value, patch.value)
  })
  routes.post('/events/:eventId/reservations', async (c) => {
    const body = await requestJson(c.req.raw, reservationSchema)
    if (body._tag === 'Failure') {
      return httpFailure(c, body.error)
    }
    const id = parse(eventIdSchema, c.req.param('eventId'))
    if (id._tag === 'Failure') {
      return httpFailure(c, id.error)
    }
    return commands.reserve(c, id.value, body.value.quantity)
  })
  routes.post('/reservations/:reservationId/cancellation', (c) => {
    const id = parse(reservationIdSchema, c.req.param('reservationId'))
    if (id._tag === 'Failure') {
      return httpFailure(c, id.error)
    }
    return commands.cancel(c, id.value)
  })
  return routes
}
