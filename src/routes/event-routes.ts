import { Hono } from 'hono'
import type { EventController } from '#/controllers/event-controller.ts'
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

export function eventRoutes(controller: EventController) {
  const routes = new Hono()
  routes.get('/events', (c) => {
    const input = parse(eventFilterSchema, c.req.query())
    if (input._tag === 'Failure') {
      return httpFailure(c, input.error)
    }
    return controller.list(c, input.value)
  })
  routes.post('/events', async (c) => {
    const input = await requestJson(c.req.raw, createEventSchema)
    if (input._tag === 'Failure') {
      return httpFailure(c, input.error)
    }
    return controller.create(c, input.value)
  })
  routes.get('/events/:eventId', (c) => {
    const id = parse(eventIdSchema, c.req.param('eventId'))
    if (id._tag === 'Failure') {
      return httpFailure(c, id.error)
    }
    return controller.get(c, id.value)
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
    return controller.update(c, id.value, patch.value)
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
    return controller.reserve(c, id.value, body.value.quantity)
  })
  routes.post('/reservations/:reservationId/cancellation', (c) => {
    const id = parse(reservationIdSchema, c.req.param('reservationId'))
    if (id._tag === 'Failure') {
      return httpFailure(c, id.error)
    }
    return controller.cancel(c, id.value)
  })
  return routes
}
