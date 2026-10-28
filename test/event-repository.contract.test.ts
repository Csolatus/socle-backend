import { afterAll, describe, expect, test } from 'bun:test'
import { Conflict, InvalidInput, NotFound } from '#/domain/errors.ts'
import { EventId, ReservationId, UserId, VenueId } from '#/domain/ids.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import {
  aReservation,
  anEvent,
  inMemoryImplementation,
  postgresImplementation,
  testDatabaseUrl,
  type RepositoryImplementation,
} from './support/repository-fixtures.ts'

const postgres = postgresImplementation(testDatabaseUrl)
const implementations: RepositoryImplementation[] = [inMemoryImplementation, postgres]

afterAll(async () => {
  await postgres.close?.()
})

for (const implementation of implementations) {
  describe.skipIf(!implementation.enabled)(
    `EventRepository contract (${implementation.name})`,
    () => {
      const setup = () => implementation.make()

      async function withEvent(capacity = 2) {
        const fixture = await setup()
        const event = anEvent(fixture.venueId, { capacity })
        Result.getOrThrow(await fixture.repository.createEvent(event))
        return { ...fixture, event }
      }
      const reserveFor =
        (userId: UserId, eventId: EventId, quantity = 1) =>
        (repository: Awaited<ReturnType<typeof setup>>['repository']) =>
          repository.reserve(eventId, () => Result.succeed(aReservation(eventId, userId, quantity)))

      describe('events', () => {
        test('createEvent then findEvent returns the same event', async () => {
          const { repository, event } = await withEvent()

          const found = await repository.findEvent(event.data.id)

          expect(Option.isSome(found)).toBe(true)
          if (Option.isSome(found)) {
            expect(found.value.data).toEqual(event.data)
          }
        })

        test('findEvent returns None for an unknown id', async () => {
          const { repository } = await setup()

          expect(Option.isNone(await repository.findEvent(EventId.make()))).toBe(true)
        })

        test('createEvent rejects an unknown venue as InvalidInput', async () => {
          const { repository } = await setup()

          const result = await repository.createEvent(anEvent(VenueId.make()))

          expect(result._tag).toBe('Failure')
          if (result._tag === 'Failure') {
            expect(result.error).toBeInstanceOf(InvalidInput)
          }
        })

        test('listEvents filters by category and start date, ordered by start then id', async () => {
          const { repository, venueId } = await setup()
          const category = `cat-${EventId.make()}`
          const early = anEvent(venueId, {
            category,
            startsAt: new Date('2098-01-01T10:00:00Z'),
          })
          const late = anEvent(venueId, {
            category,
            startsAt: new Date('2098-06-01T10:00:00Z'),
          })
          const other = anEvent(venueId, { category: `other-${category}` })
          for (const event of [late, early, other]) {
            Result.getOrThrow(await repository.createEvent(event))
          }

          const all = await repository.listEvents({ category })
          const after = await repository.listEvents({
            category,
            after: new Date('2098-03-01T00:00:00Z'),
          })

          expect(all.map((e) => e.data.id)).toEqual([early.data.id, late.data.id])
          expect(after.map((e) => e.data.id)).toEqual([late.data.id])
        })

        test('updateEvent persists a successful change', async () => {
          const { repository, event } = await withEvent()

          const result = await repository.updateEvent(event.data.id, (current) =>
            current.update({ title: 'Renamed' }, 0, new Date('2030-01-01')),
          )

          expect(result._tag).toBe('Success')
          const found = await repository.findEvent(event.data.id)
          expect(Option.isSome(found) && found.value.data.title).toBe('Renamed')
        })

        test('updateEvent on an unknown id fails with NotFound', async () => {
          const { repository } = await setup()

          const result = await repository.updateEvent(EventId.make(), (e) => Result.succeed(e))

          expect(result._tag === 'Failure' && result.error).toBeInstanceOf(NotFound)
        })

        test('updateEvent passes the reserved seats and writes nothing on Failure', async () => {
          const { repository, event, alice } = await withEvent(3)
          Result.getOrThrow(await reserveFor(alice, event.data.id, 2)(repository))
          let seen = -1

          const result = await repository.updateEvent(event.data.id, (current, reserved) => {
            seen = reserved
            return current.update({ capacity: 1, title: 'Nope' }, reserved, new Date('2030-01-01'))
          })

          expect(seen).toBe(2)
          expect(result._tag === 'Failure' && result.error).toBeInstanceOf(Conflict)
          const found = await repository.findEvent(event.data.id)
          expect(Option.isSome(found) && found.value.data.capacity).toBe(3)
          expect(Option.isSome(found) && found.value.data.title).toBe(event.data.title)
        })

        test('updateEvent rejects an unknown venue as InvalidInput and keeps the event', async () => {
          const { repository, event } = await withEvent()

          const result = await repository.updateEvent(event.data.id, (current) =>
            current.update({ venueId: VenueId.make() }, 0, new Date('2030-01-01')),
          )

          expect(result._tag === 'Failure' && result.error).toBeInstanceOf(InvalidInput)
          const found = await repository.findEvent(event.data.id)
          expect(Option.isSome(found) && found.value.data.venueId).toBe(event.data.venueId)
        })
      })

      describe('reservations', () => {
        test('reserve persists and listReservations returns it for that user only', async () => {
          const { repository, event, alice, bob } = await withEvent()

          const result = await reserveFor(alice, event.data.id)(repository)

          expect(result._tag).toBe('Success')
          expect(await repository.listReservations(alice)).toHaveLength(1)
          expect(await repository.listReservations(bob)).toHaveLength(0)
        })

        test('reserve reports the seats already taken and ignores cancelled ones', async () => {
          const { repository, event, alice, bob } = await withEvent(5)
          const first = Result.getOrThrow(await reserveFor(alice, event.data.id, 2)(repository))
          Result.getOrThrow(await reserveFor(bob, event.data.id, 1)(repository))
          Result.getOrThrow(
            await repository.cancelReservation(first.data.id, alice, (r) =>
              r.cancel(new Date('2030-01-01')),
            ),
          )
          let seen = -1

          await repository.reserve(event.data.id, (_event, reserved) => {
            seen = reserved
            return Result.fail(new Conflict('stop'))
          })

          expect(seen).toBe(1)
        })

        test('reserve on an unknown event fails with NotFound', async () => {
          const { repository, alice } = await setup()

          const result = await reserveFor(alice, EventId.make())(repository)

          expect(result._tag === 'Failure' && result.error).toBeInstanceOf(NotFound)
        })

        test('reserve writes nothing when the callback fails', async () => {
          const { repository, event, alice } = await withEvent()

          const result = await repository.reserve(event.data.id, () =>
            Result.fail(new Conflict('Not enough seats')),
          )

          expect(result._tag).toBe('Failure')
          expect(await repository.listReservations(alice)).toHaveLength(0)
        })

        test('reserve rejects an unknown user as InvalidInput and writes nothing', async () => {
          const { repository, event } = await withEvent()
          const ghost = UserId.make()

          const result = await reserveFor(ghost, event.data.id)(repository)

          expect(result._tag === 'Failure' && result.error).toBeInstanceOf(InvalidInput)
          expect(await repository.listReservations(ghost)).toHaveLength(0)
        })

        test('listReservations is ordered by creation date', async () => {
          const { repository, event, alice } = await withEvent(5)
          const later = aReservation(event.data.id, alice, 1, new Date('2030-02-01T00:00:00Z'))
          const earlier = aReservation(event.data.id, alice, 1, new Date('2030-01-01T00:00:00Z'))
          for (const r of [later, earlier]) {
            Result.getOrThrow(await repository.reserve(event.data.id, () => Result.succeed(r)))
          }

          const listed = await repository.listReservations(alice)

          expect(listed.map((r) => r.data.id)).toEqual([earlier.data.id, later.data.id])
        })
      })

      describe('cancelReservation', () => {
        test('cancels and persists cancelledAt', async () => {
          const { repository, event, alice } = await withEvent()
          const reservation = Result.getOrThrow(await reserveFor(alice, event.data.id)(repository))
          const now = new Date('2030-01-01T00:00:00Z')

          const result = await repository.cancelReservation(reservation.data.id, alice, (r) =>
            r.cancel(now),
          )

          expect(result._tag).toBe('Success')
          const [stored] = await repository.listReservations(alice)
          expect(stored && Option.isSome(stored.data.cancelledAt)).toBe(true)
        })

        test('a cancelled reservation frees its seats', async () => {
          const { repository, event, alice, bob } = await withEvent(1)
          const reservation = Result.getOrThrow(await reserveFor(alice, event.data.id)(repository))
          Result.getOrThrow(
            await repository.cancelReservation(reservation.data.id, alice, (r) =>
              r.cancel(new Date('2030-01-01')),
            ),
          )

          const again = await repository.reserve(event.data.id, (e, reserved) => {
            const check = e.checkReservation(1, reserved, new Date('2030-01-01'))
            return check._tag === 'Failure'
              ? check
              : Result.succeed(aReservation(event.data.id, bob))
          })

          expect(again._tag).toBe('Success')
        })

        test('another user gets NotFound and the reservation stays active', async () => {
          const { repository, event, alice, bob } = await withEvent()
          const reservation = Result.getOrThrow(await reserveFor(alice, event.data.id)(repository))

          const result = await repository.cancelReservation(reservation.data.id, bob, (r) =>
            r.cancel(new Date('2030-01-01')),
          )

          expect(result._tag === 'Failure' && result.error).toBeInstanceOf(NotFound)
          const [stored] = await repository.listReservations(alice)
          expect(stored && Option.isNone(stored.data.cancelledAt)).toBe(true)
        })

        test('unknown reservation fails with NotFound', async () => {
          const { repository, alice } = await setup()

          const result = await repository.cancelReservation(ReservationId.make(), alice, (r) =>
            r.cancel(new Date()),
          )

          expect(result._tag === 'Failure' && result.error).toBeInstanceOf(NotFound)
        })

        test('cancelling twice fails with Conflict', async () => {
          const { repository, event, alice } = await withEvent()
          const reservation = Result.getOrThrow(await reserveFor(alice, event.data.id)(repository))
          const cancel = () =>
            repository.cancelReservation(reservation.data.id, alice, (r) =>
              r.cancel(new Date('2030-01-01')),
            )
          Result.getOrThrow(await cancel())

          const second = await cancel()

          expect(second._tag === 'Failure' && second.error).toBeInstanceOf(Conflict)
        })
      })

      describe('users', () => {
        test('userExists is true for a known user and false otherwise', async () => {
          const { repository, alice } = await setup()

          expect(await repository.userExists(alice)).toBe(true)
          expect(await repository.userExists(UserId.make())).toBe(false)
        })
      })

      describe('concurrency', () => {
        const seatPolicy =
          (userId: UserId, event: ReturnType<typeof anEvent>) =>
          (current: typeof event, reserved: number) => {
            const check = current.checkReservation(1, reserved, new Date('2030-01-01'))
            return check._tag === 'Failure'
              ? check
              : Result.succeed(aReservation(event.data.id, userId))
          }

        test('two reserves on the last seat produce exactly one success', async () => {
          const { repository, event, alice, bob } = await withEvent(1)

          const results = await Promise.all(
            [alice, bob].map((userId) =>
              repository.reserve(event.data.id, seatPolicy(userId, event)),
            ),
          )

          expect(results.filter((r) => r._tag === 'Success')).toHaveLength(1)
          const failure = results.find((r) => r._tag === 'Failure')
          expect(failure?._tag === 'Failure' && failure.error).toBeInstanceOf(Conflict)
          const total =
            (await repository.listReservations(alice)).length +
            (await repository.listReservations(bob)).length
          expect(total).toBe(1)
        })

        test('many concurrent reserves never exceed capacity', async () => {
          const capacity = 3
          const { repository, event, alice, bob } = await withEvent(capacity)

          const results = await Promise.all(
            Array.from({ length: 12 }, (_, i) =>
              repository.reserve(event.data.id, seatPolicy(i % 2 === 0 ? alice : bob, event)),
            ),
          )

          expect(results.filter((r) => r._tag === 'Success')).toHaveLength(capacity)
        })

        test('concurrent cancel and reserve on a full event stay consistent', async () => {
          const { repository, event, alice, bob } = await withEvent(1)
          const held = Result.getOrThrow(await reserveFor(alice, event.data.id)(repository))

          const [cancelled, reserved] = await Promise.all([
            repository.cancelReservation(held.data.id, alice, (r) =>
              r.cancel(new Date('2030-01-01')),
            ),
            repository.reserve(event.data.id, seatPolicy(bob, event)),
          ])

          expect(cancelled._tag).toBe('Success')
          const active = [
            ...(await repository.listReservations(alice)),
            ...(await repository.listReservations(bob)),
          ].filter((r) => Option.isNone(r.data.cancelledAt))
          expect(active.length).toBeLessThanOrEqual(1)
          if (reserved._tag === 'Success') {
            expect(active.map((r) => r.data.userId)).toEqual([bob])
          }
        })
      })
    },
  )
}
