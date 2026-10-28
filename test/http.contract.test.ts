import { afterAll, describe, expect, test } from 'bun:test'
import { createApp } from '#/app.ts'
import { createServices } from '#/application/services.ts'
import { EventId, UserId, VenueId } from '#/domain/ids.ts'
import {
  inMemoryImplementation,
  postgresImplementation,
  testDatabaseUrl,
  type RepositoryImplementation,
} from './support/repository-fixtures.ts'

const postgres = postgresImplementation(testDatabaseUrl)
const implementations: RepositoryImplementation[] = [
  inMemoryImplementation,
  postgres,
]

afterAll(async () => {
  await postgres.close?.()
})

for (const implementation of implementations) {
  describe.skipIf(!implementation.enabled)(
    `HTTP API (${implementation.name})`,
    () => {
      async function anApi() {
        const fixture = await implementation.make()
        const services = createServices(fixture.repository, {
          now: () => new Date('2030-01-01T00:00:00Z'),
        })
        const app = createApp(services, {
          mcpUrl: () => 'http://127.0.0.1:3000/mcp',
        })
        const call = (
          path: string,
          options: { method?: string; body?: unknown; user?: UserId } = {},
        ) =>
          app.request(path, {
            method: options.method ?? 'GET',
            headers: {
              'Content-Type': 'application/json',
              ...(options.user ? { 'X-User-Id': options.user } : {}),
            },
            body:
              options.body === undefined
                ? undefined
                : JSON.stringify(options.body),
          })
        return { ...fixture, call }
      }
      async function withEvent(capacity = 2) {
        const api = await anApi()
        const response = await api.call('/events', {
          method: 'POST',
          body: {
            title: 'HTTP test',
            category: `cat-${EventId.make()}`,
            startsAt: '2099-01-01T18:00:00.000Z',
            capacity,
            venueId: api.venueId,
          },
        })
        const event = await response.json()
        return { ...api, event }
      }
      const reserve = (
        api: Awaited<ReturnType<typeof withEvent>>,
        user: UserId,
        quantity = 1,
      ) =>
        api.call(`/events/${api.event.id}/reservations`, {
          method: 'POST',
          body: { quantity },
          user,
        })

      test('POST /events returns 201, a Location header and the stored event', async () => {
        const { call, venueId } = await anApi()

        const response = await call('/events', {
          method: 'POST',
          body: {
            title: 'Created',
            category: 'gaming',
            startsAt: '2099-01-01T18:00:00.000Z',
            capacity: 4,
            venueId,
          },
        })
        const created = await response.json()
        const fetched = await call(`/events/${created.id}`)

        expect(response.status).toBe(201)
        expect(response.headers.get('Location')).toBe(`/events/${created.id}`)
        expect(fetched.status).toBe(200)
        expect(await fetched.json()).toEqual(created)
      })

      test('POST /events with an unknown venue returns 400 INVALID_INPUT', async () => {
        const { call } = await anApi()

        const response = await call('/events', {
          method: 'POST',
          body: {
            title: 'Orphan',
            category: 'gaming',
            startsAt: '2099-01-01T18:00:00.000Z',
            capacity: 4,
            venueId: VenueId.make(),
          },
        })

        expect(response.status).toBe(400)
        expect((await response.json()).error.code).toBe('INVALID_INPUT')
      })

      test('POST /events with an invalid body returns 400', async () => {
        const { call, venueId } = await anApi()

        const response = await call('/events', {
          method: 'POST',
          body: { title: '', venueId },
        })

        expect(response.status).toBe(400)
      })

      test('GET /events/:id returns 404 for an unknown event', async () => {
        const { call } = await anApi()

        const response = await call(`/events/${EventId.make()}`)

        expect(response.status).toBe(404)
        expect((await response.json()).error.code).toBe('NOT_FOUND')
      })

      test('GET /events/:id returns 400 for a malformed id', async () => {
        const { call } = await anApi()

        const response = await call('/events/not-a-uuid')

        expect(response.status).toBe(400)
      })

      test('GET /events filters by category', async () => {
        const { call, event } = await withEvent()

        const response = await call(`/events?category=${event.category}`)
        const listed = await response.json()

        expect(response.status).toBe(200)
        expect(listed.map((e: { id: string }) => e.id)).toEqual([event.id])
      })

      test('PATCH /events/:id updates the event', async () => {
        const { call, event } = await withEvent()

        const response = await call(`/events/${event.id}`, {
          method: 'PATCH',
          body: { title: 'Patched' },
        })

        expect(response.status).toBe(200)
        expect((await response.json()).title).toBe('Patched')
        const fetched = await (await call(`/events/${event.id}`)).json()
        expect(fetched.title).toBe('Patched')
      })

      test('PATCH /events/:id returns 409 when capacity drops below reserved seats', async () => {
        const api = await withEvent(3)
        await reserve(api, api.alice, 2)

        const response = await api.call(`/events/${api.event.id}`, {
          method: 'PATCH',
          body: { capacity: 1 },
        })

        expect(response.status).toBe(409)
        expect((await response.json()).error.code).toBe('CONFLICT')
      })

      test('POST reservations without X-User-Id returns 401', async () => {
        const { call, event } = await withEvent()

        const response = await call(`/events/${event.id}/reservations`, {
          method: 'POST',
          body: { quantity: 1 },
        })

        expect(response.status).toBe(401)
        expect((await response.json()).error.code).toBe('UNAUTHORIZED')
      })

      test('POST reservations with an unknown user returns 401', async () => {
        const api = await withEvent()

        const response = await reserve(api, UserId.make())

        expect(response.status).toBe(401)
      })

      test('reservation lifecycle: reserve, list, cancel, list again', async () => {
        const api = await withEvent()
        const { call, event, alice } = api

        const reserved = await reserve(api, alice, 2)
        const reservation = await reserved.json()
        const mine = await (
          await call('/me/reservations', { user: alice })
        ).json()
        const cancelled = await call(
          `/reservations/${reservation.id}/cancellation`,
          { method: 'POST', user: alice },
        )
        const afterCancel = await (
          await call('/me/reservations', { user: alice })
        ).json()

        expect(reserved.status).toBe(201)
        expect(reservation).toMatchObject({
          eventId: event.id,
          userId: alice,
          quantity: 2,
          cancelledAt: null,
        })
        expect(mine.map((r: { id: string }) => r.id)).toEqual([reservation.id])
        expect(cancelled.status).toBe(200)
        expect((await cancelled.json()).cancelledAt).toBe(
          '2030-01-01T00:00:00.000Z',
        )
        expect(afterCancel[0].cancelledAt).toBe('2030-01-01T00:00:00.000Z')
      })

      test('reserving beyond capacity returns 409', async () => {
        const api = await withEvent(1)
        await reserve(api, api.alice)

        const response = await reserve(api, api.bob)

        expect(response.status).toBe(409)
      })

      test('reserving an unknown event returns 404', async () => {
        const { call, alice } = await anApi()

        const response = await call(`/events/${EventId.make()}/reservations`, {
          method: 'POST',
          body: { quantity: 1 },
          user: alice,
        })

        expect(response.status).toBe(404)
      })

      test('cancelling a reservation of another user returns 404', async () => {
        const api = await withEvent()
        const reservation = await (await reserve(api, api.alice)).json()

        const response = await api.call(
          `/reservations/${reservation.id}/cancellation`,
          { method: 'POST', user: api.bob },
        )

        expect(response.status).toBe(404)
      })

      test('cancelling twice returns 409', async () => {
        const api = await withEvent()
        const reservation = await (await reserve(api, api.alice)).json()
        const cancel = () =>
          api.call(`/reservations/${reservation.id}/cancellation`, {
            method: 'POST',
            user: api.alice,
          })
        await cancel()

        const second = await cancel()

        expect(second.status).toBe(409)
      })

      test('two simultaneous HTTP reservations for the last seat yield one 201 and one 409', async () => {
        const api = await withEvent(1)

        const responses = await Promise.all(
          [api.alice, api.bob].map((user) => reserve(api, user)),
        )

        expect(responses.map((r) => r.status).sort()).toEqual([201, 409])
      })
    },
  )
}
