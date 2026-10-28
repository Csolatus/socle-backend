import { SQL } from 'bun'
import type { EventRepository } from '#/application/ports.ts'
import { Event } from '#/domain/event.ts'
import { EventId, UserId, VenueId } from '#/domain/ids.ts'
import { Reservation } from '#/domain/reservation.ts'
import { ReservationId } from '#/domain/ids.ts'
import { InMemoryEventRepository } from '#/infrastructure/in-memory-event-repository.ts'
import { PostgresEventRepository } from '#/infrastructure/postgres-event-repository.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'

export interface RepositoryFixture {
  repository: EventRepository
  alice: UserId
  bob: UserId
  venueId: VenueId
}

export interface RepositoryImplementation {
  name: string
  enabled: boolean
  make(): Promise<RepositoryFixture>
  close?(): Promise<void>
}

export const testDatabaseUrl = process.env.TEST_DATABASE_URL

export const inMemoryImplementation: RepositoryImplementation = {
  name: 'InMemory',
  enabled: true,
  async make() {
    const alice = UserId.make()
    const bob = UserId.make()
    const venueId = VenueId.make()
    return {
      alice,
      bob,
      venueId,
      repository: new InMemoryEventRepository({
        users: new Set([alice, bob]),
        venues: new Set([venueId]),
      }),
    }
  },
}

export function postgresImplementation(
  url: string | undefined,
): RepositoryImplementation {
  let sql: SQL | undefined
  return {
    name: 'Postgres',
    enabled: url !== undefined,
    async make() {
      sql ??= new SQL(url!)
      const alice = UserId.make()
      const bob = UserId.make()
      const venueId = VenueId.make()
      await sql`INSERT INTO users (id, name, email) VALUES
        (${alice}, 'Alice', ${`alice-${alice}@test.local`}),
        (${bob}, 'Bob', ${`bob-${bob}@test.local`})`
      await sql`INSERT INTO venues (id, name, address)
        VALUES (${venueId}, 'Test venue', '1 rue du Test')`
      return {
        alice,
        bob,
        venueId,
        repository: new PostgresEventRepository(sql),
      }
    },
    async close() {
      await sql?.close()
    },
  }
}

export function anEvent(
  venueId: VenueId,
  overrides: Partial<{
    id: EventId
    title: string
    category: string
    startsAt: Date
    capacity: number
  }> = {},
) {
  return Result.getOrThrow(
    Event.create({
      id: EventId.make(),
      title: 'Contract test',
      category: 'gaming',
      startsAt: new Date('2099-01-01T18:00:00Z'),
      capacity: 2,
      venueId,
      ...overrides,
    }),
  )
}

export function aReservation(
  eventId: EventId,
  userId: UserId,
  quantity = 1,
  createdAt = new Date('2030-01-01T00:00:00Z'),
) {
  return new Reservation({
    id: ReservationId.make(),
    eventId,
    userId,
    quantity,
    createdAt,
    cancelledAt: Option.none(),
  })
}
