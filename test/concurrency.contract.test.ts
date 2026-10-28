import { afterAll, describe, expect, test } from 'bun:test'
import { createServices } from '#/application/services.ts'
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

afterAll(async () => {
  await postgres.close?.()
})

for (const implementation of implementations) {
  describe.skipIf(!implementation.enabled)(
    `concurrency (${implementation.name})`,
    () => {
      async function withEvent(capacity: number) {
        const fixture = await implementation.make()
        const services = createServices(fixture.repository, { now: () => now })
        const event = Result.getOrThrow(
          await services.create.execute({
            title: 'Concurrency',
            category: 'gaming',
            startsAt: new Date('2099-01-01T18:00:00Z'),
            capacity,
            venueId: fixture.venueId,
          }),
        )
        return { ...fixture, services, event }
      }
      const activeSeats = async (
        services: Awaited<ReturnType<typeof withEvent>>['services'],
        users: Awaited<ReturnType<typeof withEvent>>['alice'][],
      ) => {
        const lists = await Promise.all(
          users.map((user) => services.read.reservationsFor(user)),
        )
        return lists
          .flat()
          .filter((r) => Option.isNone(r.data.cancelledAt))
          .reduce((total, r) => total + r.data.quantity, 0)
      }

      test('reservations of different sizes never exceed capacity', async () => {
        const { services, event, alice, bob } = await withEvent(5)

        const results = await Promise.all(
          Array.from({ length: 20 }, (_, i) =>
            services.reserve.execute({
              eventId: event.data.id,
              userId: i % 2 === 0 ? alice : bob,
              quantity: (i % 3) + 1,
            }),
          ),
        )

        const seats = await activeSeats(services, [alice, bob])
        expect(seats).toBeLessThanOrEqual(5)
        expect(seats).toBe(
          results.reduce(
            (total, r) =>
              r._tag === 'Success' ? total + r.value.data.quantity : total,
            0,
          ),
        )
      })

      test('capacity updates racing with reservations keep reserved <= capacity', async () => {
        const { services, event, alice, bob } = await withEvent(6)

        await Promise.all([
          ...Array.from({ length: 8 }, (_, i) =>
            services.reserve.execute({
              eventId: event.data.id,
              userId: i % 2 === 0 ? alice : bob,
              quantity: 1,
            }),
          ),
          services.update.execute(event.data.id, { capacity: 3 }),
          services.update.execute(event.data.id, { capacity: 4 }),
        ])

        const stored = Result.getOrThrow(await services.read.get(event.data.id))
        const seats = await activeSeats(services, [alice, bob])
        expect(seats).toBeLessThanOrEqual(stored.data.capacity)
      })

      test('concurrent cancellations of the same reservation succeed once', async () => {
        const { services, event, alice } = await withEvent(2)
        const reservation = Result.getOrThrow(
          await services.reserve.execute({
            eventId: event.data.id,
            userId: alice,
            quantity: 1,
          }),
        )

        const results = await Promise.all(
          Array.from({ length: 5 }, () =>
            services.cancel.execute(reservation.data.id, alice),
          ),
        )

        expect(results.filter((r) => r._tag === 'Success')).toHaveLength(1)
        expect(results.filter((r) => r._tag === 'Failure')).toHaveLength(4)
      })

      test('freed seats are reusable by racing reservations', async () => {
        const { services, event, alice, bob } = await withEvent(2)
        const held = Result.getOrThrow(
          await services.reserve.execute({
            eventId: event.data.id,
            userId: alice,
            quantity: 2,
          }),
        )

        const [, ...reservations] = await Promise.all([
          services.cancel.execute(held.data.id, alice),
          ...Array.from({ length: 4 }, () =>
            services.reserve.execute({
              eventId: event.data.id,
              userId: bob,
              quantity: 1,
            }),
          ),
        ])

        const seats = await activeSeats(services, [alice, bob])
        expect(seats).toBeLessThanOrEqual(2)
        expect(
          reservations.filter((r) => r._tag === 'Success').length,
        ).toBeLessThanOrEqual(2)
      })

      test('independent events do not block each other', async () => {
        const first = await withEvent(1)
        const second = await withEvent(1)

        const results = await Promise.all([
          first.services.reserve.execute({
            eventId: first.event.data.id,
            userId: first.alice,
            quantity: 1,
          }),
          second.services.reserve.execute({
            eventId: second.event.data.id,
            userId: second.alice,
            quantity: 1,
          }),
        ])

        expect(results.map((r) => r._tag)).toEqual(['Success', 'Success'])
      })
    },
  )
}
