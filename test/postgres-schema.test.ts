import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { EventId, UserId, VenueId } from '#/domain/ids.ts'
import { createDatabase } from '#/infrastructure/db.ts'
import { testDatabaseUrl } from './support/repository-fixtures.ts'

const database = testDatabaseUrl ? createDatabase(testDatabaseUrl) : undefined

beforeAll(async () => {
  if (database) {
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    })
  }
})

afterAll(async () => {
  await database?.sql.close()
})

describe.skipIf(!database)('PostgreSQL schema constraints', () => {
  const sql = () => database!.sql

  async function aVenue() {
    const id = VenueId.make()
    await sql()`INSERT INTO venues (id, name, address) VALUES (${id}, 'V', 'A')`
    return id
  }
  async function aUser() {
    const id = UserId.make()
    await sql()`INSERT INTO users (id, name, email)
      VALUES (${id}, 'U', ${`${id}@test.local`})`
    return id
  }
  async function anEvent(venueId: VenueId, capacity = 2) {
    const id = EventId.make()
    await sql()`INSERT INTO events (id, title, category, starts_at, capacity, venue_id)
      VALUES (${id}, 'T', 'c', '2099-01-01T00:00:00Z', ${capacity}, ${venueId})`
    return id
  }
  const rejected = async (statement: Promise<unknown>) => {
    try {
      await statement
    } catch (error) {
      return error as { errno?: string }
    }
    return undefined
  }

  test('users.email is unique', async () => {
    const email = `dup-${UserId.make()}@test.local`
    await sql()`INSERT INTO users (id, name, email) VALUES (${UserId.make()}, 'A', ${email})`

    const error = await rejected(
      sql()`INSERT INTO users (id, name, email) VALUES (${UserId.make()}, 'B', ${email})`,
    )

    expect(error?.errno).toBe('23505')
  })

  test('events.title and category must not be blank', async () => {
    const venueId = await aVenue()

    const blankTitle = await rejected(
      sql()`INSERT INTO events (id, title, category, starts_at, capacity, venue_id)
        VALUES (${EventId.make()}, '   ', 'c', now(), 1, ${venueId})`,
    )
    const blankCategory = await rejected(
      sql()`INSERT INTO events (id, title, category, starts_at, capacity, venue_id)
        VALUES (${EventId.make()}, 't', '', now(), 1, ${venueId})`,
    )

    expect(blankTitle?.errno).toBe('23514')
    expect(blankCategory?.errno).toBe('23514')
  })

  test('events.capacity must be positive', async () => {
    const venueId = await aVenue()

    for (const capacity of [0, -3]) {
      const error = await rejected(
        sql()`INSERT INTO events (id, title, category, starts_at, capacity, venue_id)
          VALUES (${EventId.make()}, 't', 'c', now(), ${capacity}, ${venueId})`,
      )
      expect(error?.errno).toBe('23514')
    }
  })

  test('events.venue_id must reference an existing venue', async () => {
    const error = await rejected(
      sql()`INSERT INTO events (id, title, category, starts_at, capacity, venue_id)
        VALUES (${EventId.make()}, 't', 'c', now(), 1, ${VenueId.make()})`,
    )

    expect(error?.errno).toBe('23503')
  })

  test('reservations.quantity must be positive', async () => {
    const eventId = await anEvent(await aVenue())
    const userId = await aUser()

    for (const quantity of [0, -1]) {
      const error = await rejected(
        sql()`INSERT INTO reservations (id, event_id, user_id, quantity)
          VALUES (${crypto.randomUUID()}, ${eventId}, ${userId}, ${quantity})`,
      )
      expect(error?.errno).toBe('23514')
    }
  })

  test('reservations reference an existing event and user', async () => {
    const eventId = await anEvent(await aVenue())
    const userId = await aUser()

    const unknownEvent = await rejected(
      sql()`INSERT INTO reservations (id, event_id, user_id, quantity)
        VALUES (${crypto.randomUUID()}, ${EventId.make()}, ${userId}, 1)`,
    )
    const unknownUser = await rejected(
      sql()`INSERT INTO reservations (id, event_id, user_id, quantity)
        VALUES (${crypto.randomUUID()}, ${eventId}, ${UserId.make()}, 1)`,
    )

    expect(unknownEvent?.errno).toBe('23503')
    expect(unknownUser?.errno).toBe('23503')
  })

  test('reservations.created_at defaults to now and cancelled_at to null', async () => {
    const eventId = await anEvent(await aVenue())
    const userId = await aUser()
    const id = crypto.randomUUID()
    await sql()`INSERT INTO reservations (id, event_id, user_id, quantity)
      VALUES (${id}, ${eventId}, ${userId}, 1)`

    const [row] =
      await sql()`SELECT created_at, cancelled_at FROM reservations WHERE id = ${id}`

    expect(row.created_at).toBeInstanceOf(Date)
    expect(row.cancelled_at).toBeNull()
  })

  test('an event or user with reservations cannot be deleted', async () => {
    const eventId = await anEvent(await aVenue())
    const userId = await aUser()
    await sql()`INSERT INTO reservations (id, event_id, user_id, quantity)
      VALUES (${crypto.randomUUID()}, ${eventId}, ${userId}, 1)`

    const eventDelete = await rejected(
      sql()`DELETE FROM events WHERE id = ${eventId}`,
    )
    const userDelete = await rejected(
      sql()`DELETE FROM users WHERE id = ${userId}`,
    )

    expect(eventDelete?.errno).toBe('23503')
    expect(userDelete?.errno).toBe('23503')
  })

  test('the expected indexes exist', async () => {
    const rows =
      await sql()`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`
    const names = rows.map((row: { indexname: string }) => row.indexname)

    expect(names).toEqual(
      expect.arrayContaining([
        'events_starts_at_idx',
        'events_category_starts_at_idx',
        'reservations_event_id_idx',
        'reservations_user_id_idx',
      ]),
    )
  })

  test('the seed script is idempotent', async () => {
    const seed = fileURLToPath(new URL('../sql/seed.sql', import.meta.url))

    await sql().file(seed)
    await sql().file(seed)

    const [users] = await sql()`SELECT count(*)::int AS n FROM users
      WHERE id IN ('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000002')`
    const [events] = await sql()`SELECT count(*)::int AS n FROM events
      WHERE id = '01900000-0000-7000-8000-000000000004'`
    expect(users.n).toBe(2)
    expect(events.n).toBe(1)
  })
})
