import { afterAll, describe, expect, test } from 'bun:test'
import { createServices } from '#/application/services.ts'
import { Conflict, InvalidInput, NotFound } from '#/domain/errors.ts'
import { EventId } from '#/domain/ids.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
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
const now = new Date('2030-01-01T00:00:00Z')
const future = new Date('2099-01-01T18:00:00Z')

afterAll(async () => {
  await postgres.close?.()
})

for (const implementation of implementations) {
  describe.skipIf(!implementation.enabled)(
    `application services (${implementation.name})`,
    () => {
      async function aBackend() {
        const fixture = await implementation.make()
        const services = createServices(fixture.repository, { now: () => now })
        return { ...fixture, services }
      }
      async function withEvent(capacity = 2) {
        const backend = await aBackend()
        const event = Result.getOrThrow(
          await backend.services.create.execute({
            title: 'Service test',
            category: 'gaming',
            startsAt: future,
            capacity,
            venueId: backend.venueId,
          }),
        )
        return { ...backend, event }
      }
      const failure = <Value, Error>(result: Result<Value, Error>) =>
        result._tag === 'Failure' ? result.error : undefined

      describe('create', () => {
        test('creates a future event that can then be read', async () => {
          const { services, event } = await withEvent()

          const read = await services.read.get(event.data.id)

          expect(Result.getOrThrow(read).data).toEqual(event.data)
        })

        test('rejects an event starting in the past', async () => {
          const { services, venueId } = await aBackend()

          const result = await services.create.execute({
            title: 'Past',
            category: 'gaming',
            startsAt: new Date('2020-01-01T00:00:00Z'),
            capacity: 5,
            venueId,
          })

          expect(failure(result)).toBeInstanceOf(InvalidInput)
        })

        test('rejects an empty title and a zero capacity', async () => {
          const { services, venueId } = await aBackend()

          const emptyTitle = await services.create.execute({
            title: '  ',
            category: 'gaming',
            startsAt: future,
            capacity: 5,
            venueId,
          })
          const noCapacity = await services.create.execute({
            title: 'Ok',
            category: 'gaming',
            startsAt: future,
            capacity: 0,
            venueId,
          })

          expect(failure(emptyTitle)).toBeInstanceOf(InvalidInput)
          expect(failure(noCapacity)).toBeInstanceOf(InvalidInput)
        })
      })

      describe('read', () => {
        test('get on an unknown event fails with NotFound', async () => {
          const { services } = await aBackend()

          const result = await services.read.get(EventId.make())

          expect(failure(result)).toBeInstanceOf(NotFound)
        })

        test('list excludes events starting on the boundary date', async () => {
          const { services, event } = await withEvent()

          const onBoundary = await services.read.list({
            category: event.data.category,
            after: event.data.startsAt,
          })
          const before = await services.read.list({
            category: event.data.category,
            after: new Date('2098-12-31T00:00:00Z'),
          })

          expect(onBoundary.map((e) => e.data.id)).not.toContain(event.data.id)
          expect(before.map((e) => e.data.id)).toContain(event.data.id)
        })
      })

      describe('update', () => {
        test('updates the title of a future event', async () => {
          const { services, event } = await withEvent()

          const result = await services.update.execute(event.data.id, {
            title: 'Renamed',
          })

          expect(Result.getOrThrow(result).data.title).toBe('Renamed')
        })

        test('cannot lower capacity below reserved seats', async () => {
          const { services, event, alice } = await withEvent(3)
          Result.getOrThrow(
            await services.reserve.execute({
              eventId: event.data.id,
              userId: alice,
              quantity: 2,
            }),
          )

          const result = await services.update.execute(event.data.id, {
            capacity: 1,
          })

          expect(failure(result)).toBeInstanceOf(Conflict)
          const stored = Result.getOrThrow(
            await services.read.get(event.data.id),
          )
          expect(stored.data.capacity).toBe(3)
        })

        test('can lower capacity down to the reserved seats', async () => {
          const { services, event, alice } = await withEvent(3)
          Result.getOrThrow(
            await services.reserve.execute({
              eventId: event.data.id,
              userId: alice,
              quantity: 2,
            }),
          )

          const result = await services.update.execute(event.data.id, {
            capacity: 2,
          })

          expect(Result.getOrThrow(result).data.capacity).toBe(2)
        })

        test('rejects an unknown event', async () => {
          const { services } = await aBackend()

          const result = await services.update.execute(EventId.make(), {
            title: 'x',
          })

          expect(failure(result)).toBeInstanceOf(NotFound)
        })

        test('rejects moving the event to the past', async () => {
          const { services, event } = await withEvent()

          const result = await services.update.execute(event.data.id, {
            startsAt: new Date('2020-01-01T00:00:00Z'),
          })

          expect(failure(result)).toBeInstanceOf(Conflict)
        })
      })

      describe('reserve', () => {
        test('reserves seats and lists them for the user', async () => {
          const { services, event, alice } = await withEvent()

          const result = await services.reserve.execute({
            eventId: event.data.id,
            userId: alice,
            quantity: 2,
          })

          expect(Result.getOrThrow(result).data.quantity).toBe(2)
          const listed = await services.read.reservationsFor(alice)
          expect(listed).toHaveLength(1)
          expect(listed[0]?.data.createdAt).toEqual(now)
        })

        test('rejects a quantity above the remaining seats', async () => {
          const { services, event, alice, bob } = await withEvent(2)
          Result.getOrThrow(
            await services.reserve.execute({
              eventId: event.data.id,
              userId: alice,
              quantity: 2,
            }),
          )

          const result = await services.reserve.execute({
            eventId: event.data.id,
            userId: bob,
            quantity: 1,
          })

          expect(failure(result)).toBeInstanceOf(Conflict)
          expect(await services.read.reservationsFor(bob)).toHaveLength(0)
        })

        test('rejects zero and fractional quantities', async () => {
          const { services, event, alice } = await withEvent()

          for (const quantity of [0, -1, 1.5]) {
            const result = await services.reserve.execute({
              eventId: event.data.id,
              userId: alice,
              quantity,
            })
            expect(failure(result)).toBeInstanceOf(InvalidInput)
          }
          expect(await services.read.reservationsFor(alice)).toHaveLength(0)
        })

        test('rejects an unknown event', async () => {
          const { services, alice } = await aBackend()

          const result = await services.reserve.execute({
            eventId: EventId.make(),
            userId: alice,
            quantity: 1,
          })

          expect(failure(result)).toBeInstanceOf(NotFound)
        })

        test('rejects an event that already started', async () => {
          const backend = await aBackend()
          const event = Result.getOrThrow(
            await backend.services.create.execute({
              title: 'Soon',
              category: 'gaming',
              startsAt: new Date('2030-01-01T00:00:01Z'),
              capacity: 2,
              venueId: backend.venueId,
            }),
          )
          const later = createServices(backend.repository, {
            now: () => new Date('2030-01-02T00:00:00Z'),
          })

          const result = await later.reserve.execute({
            eventId: event.data.id,
            userId: backend.alice,
            quantity: 1,
          })

          expect(failure(result)).toBeInstanceOf(Conflict)
        })
      })

      describe('cancel', () => {
        test('cancelling frees the seats for another user', async () => {
          const { services, event, alice, bob } = await withEvent(1)
          const reservation = Result.getOrThrow(
            await services.reserve.execute({
              eventId: event.data.id,
              userId: alice,
              quantity: 1,
            }),
          )

          Result.getOrThrow(
            await services.cancel.execute(reservation.data.id, alice),
          )
          const again = await services.reserve.execute({
            eventId: event.data.id,
            userId: bob,
            quantity: 1,
          })

          expect(again._tag).toBe('Success')
        })

        test('sets cancelledAt from the clock', async () => {
          const { services, event, alice } = await withEvent()
          const reservation = Result.getOrThrow(
            await services.reserve.execute({
              eventId: event.data.id,
              userId: alice,
              quantity: 1,
            }),
          )

          const cancelled = Result.getOrThrow(
            await services.cancel.execute(reservation.data.id, alice),
          )

          const at = cancelled.data.cancelledAt
          expect(Option.isSome(at) && at.value).toEqual(now)
        })

        test('only the owner can cancel', async () => {
          const { services, event, alice, bob } = await withEvent()
          const reservation = Result.getOrThrow(
            await services.reserve.execute({
              eventId: event.data.id,
              userId: alice,
              quantity: 1,
            }),
          )

          const result = await services.cancel.execute(reservation.data.id, bob)

          expect(failure(result)).toBeInstanceOf(NotFound)
        })

        test('cancelling twice is a conflict', async () => {
          const { services, event, alice } = await withEvent()
          const reservation = Result.getOrThrow(
            await services.reserve.execute({
              eventId: event.data.id,
              userId: alice,
              quantity: 1,
            }),
          )
          Result.getOrThrow(
            await services.cancel.execute(reservation.data.id, alice),
          )

          const second = await services.cancel.execute(
            reservation.data.id,
            alice,
          )

          expect(failure(second)).toBeInstanceOf(Conflict)
        })
      })
    },
  )
}
