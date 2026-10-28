import { expect, test } from 'bun:test'
import { createApp } from '#/app.ts'
import { createServices } from '#/application/services.ts'
import { EventId, UserId, VenueId } from '#/domain/ids.ts'
import { InMemoryEventRepository } from '#/infrastructure/in-memory-event-repository.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import { given } from './support/given.ts'

function aBackend() {
  const alice = UserId.make()
  const bob = UserId.make()
  const venueId = VenueId.make()
  const repository = new InMemoryEventRepository({
    users: new Set([alice, bob]),
    venues: new Set([venueId]),
  })
  const services = createServices(repository, {
    now: () => new Date('2030-01-01T00:00:00Z'),
  })
  const app = createApp(services, { mcpUrl: () => 'http://127.0.0.1:3000/mcp' })
  return { alice, bob, venueId, repository, services, app }
}
const eventInput = {
  title: 'Backend test',
  category: 'gaming',
  startsAt: new Date('2099-01-01T18:00:00Z'),
  capacity: 1,
}

async function aOneSeatEvent() {
  const backend = aBackend()
  const event = Result.getOrThrow(
    await backend.services.create.execute({
      ...eventInput,
      venueId: backend.venueId,
    }),
  )
  return { ...backend, event }
}
async function twoUsersReserveConcurrently({
  services,
  event,
  alice,
  bob,
}: Awaited<ReturnType<typeof aOneSeatEvent>>) {
  return Promise.all(
    [alice, bob].map((userId) =>
      services.reserve.execute({ eventId: event.data.id, userId, quantity: 1 }),
    ),
  )
}
function onlyOneReservationSucceeds(
  results: Awaited<ReturnType<typeof twoUsersReserveConcurrently>>,
) {
  expect(results.filter((result) => result._tag === 'Success')).toHaveLength(1)
  expect(results.filter((result) => result._tag === 'Failure')).toHaveLength(1)
}

test('competing application operations do not overbook the in-memory repository', () =>
  given(aOneSeatEvent)
    .when(twoUsersReserveConcurrently)
    .then(onlyOneReservationSucceeds))

test('missing records use Option and invalid references perform no writes', () =>
  given(aBackend)
    .when(async ({ repository, services }) => ({
      found: await repository.findEvent(EventId.make()),
      created: await services.create.execute({
        ...eventInput,
        venueId: VenueId.make(),
      }),
      missing: await services.read.get(EventId.make()),
    }))
    .then(async ({ found, created, missing }, { repository }) => {
      expect(found).toEqual(Option.none())
      expect(created._tag).toBe('Failure')
      expect(missing._tag).toBe('Failure')
      expect(await repository.listEvents({})).toEqual([])
    }))

test('application cancellation enforces ownership and returns the seat', () =>
  given(async () => {
    const backend = await aOneSeatEvent()
    const reservation = Result.getOrThrow(
      await backend.services.reserve.execute({
        eventId: backend.event.data.id,
        userId: backend.alice,
        quantity: 1,
      }),
    )
    return { ...backend, reservation }
  })
    .when(async ({ services, reservation, event, alice, bob }) => ({
      denied: await services.cancel.execute(reservation.data.id, bob),
      cancelled: await services.cancel.execute(reservation.data.id, alice),
      repeated: await services.cancel.execute(reservation.data.id, alice),
      next: await services.reserve.execute({
        eventId: event.data.id,
        userId: bob,
        quantity: 1,
      }),
    }))
    .then(
      async ({ denied, cancelled, repeated, next }, { repository, alice }) => {
        expect(denied._tag).toBe('Failure')
        expect(Result.getOrThrow(cancelled).data.cancelledAt).toEqual(
          Option.some(new Date('2030-01-01T00:00:00Z')),
        )
        expect(repeated._tag).toBe('Failure')
        expect(next._tag).toBe('Success')
        expect(
          (await repository.listReservations(alice))[0]!.data.cancelledAt._tag,
        ).toBe('Some')
      },
    ))

test('HTTP creation returns the DTO and Location without bypassing the application', () =>
  given(aBackend)
    .when(({ app, venueId }) =>
      app.request('/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...eventInput, venueId }),
      }),
    )
    .then(async (response, { repository }) => {
      expect(response.status).toBe(201)
      const event = await response.json()
      expect(response.headers.get('Location')).toBe(`/events/${event.id}`)
      expect(
        Option.isSome(await repository.findEvent(EventId.makeUnsafe(event.id))),
      ).toBe(true)
    }))

test('event filters use an exclusive date boundary and category', () =>
  given(async () => {
    const backend = await aOneSeatEvent()
    const later = Result.getOrThrow(
      await backend.services.create.execute({
        ...eventInput,
        title: 'Later',
        startsAt: new Date('2099-01-02T18:00:00Z'),
        venueId: backend.venueId,
      }),
    )
    return { ...backend, later }
  })
    .when(async ({ repository, event }) => ({
      later: await repository.listEvents({
        category: 'gaming',
        after: event.data.startsAt,
      }),
      unrelated: await repository.listEvents({ category: 'missing' }),
    }))
    .then(({ later, unrelated }, fixture) => {
      expect(later.map(({ data }) => data.id)).toEqual([fixture.later.data.id])
      expect(unrelated).toEqual([])
    }))
