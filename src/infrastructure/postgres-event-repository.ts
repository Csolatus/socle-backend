import { SQL } from 'bun'
import { and, asc, DrizzleQueryError, eq, gt, isNull, sql } from 'drizzle-orm'
import type {
  ApplicationError,
  EventFilter,
  EventRepository,
} from '#/application/ports.ts'
import type { Event } from '#/domain/event.ts'
import type { Reservation } from '#/domain/reservation.ts'
import type { EventId, ReservationId, UserId } from '#/domain/ids.ts'
import { InvalidInput, NotFound } from '#/domain/errors.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import type { Database } from '#/infrastructure/db.ts'
import { events, reservations, users } from '#/infrastructure/schema.ts'
import { eventToDomain, eventToEntity } from '#/infrastructure/event-entity.ts'
import {
  reservationFromRow,
  reservationToDomain,
  reservationToEntity,
  reservationToRow,
} from '#/infrastructure/reservation-entity.ts'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

export class PostgresEventRepository implements EventRepository {
  constructor(private readonly db: Database) {}

  async listEvents(filter: EventFilter) {
    const rows = await this.db
      .select()
      .from(events)
      .where(
        and(
          filter.category === undefined
            ? undefined
            : eq(events.category, filter.category),
          filter.after === undefined
            ? undefined
            : gt(events.startsAt, filter.after),
        ),
      )
      .orderBy(asc(events.startsAt), asc(events.id))
    return rows.map(eventToDomain)
  }

  async findEvent(id: EventId): Promise<Option<Event>> {
    const [row] = await this.db.select().from(events).where(eq(events.id, id))
    return Option.map(Option.fromNullable(row), eventToDomain)
  }

  async createEvent(event: Event): Promise<Result<Event, ApplicationError>> {
    return this.write(async () => {
      await this.db.insert(events).values(eventToEntity(event))
      return Result.succeed(event)
    })
  }

  async updateEvent(
    id: EventId,
    change: (
      event: Event,
      reservedSeats: number,
    ) => Result<Event, ApplicationError>,
  ): Promise<Result<Event, ApplicationError>> {
    return this.write(() =>
      this.db.transaction(async (tx) => {
        const found = await this.lockEvent(tx, id)
        if (Option.isNone(found)) {
          return Result.fail(new NotFound('Event not found'))
        }
        const updated = change(found.value, await this.reservedSeats(tx, id))
        if (updated._tag === 'Failure') {
          return updated
        }
        const { title, category, startsAt, capacity, venueId } = eventToEntity(
          updated.value,
        )
        await tx
          .update(events)
          .set({ title, category, startsAt, capacity, venueId })
          .where(eq(events.id, id))
        return updated
      }),
    )
  }

  async reserve(
    eventId: EventId,
    create: (
      event: Event,
      reservedSeats: number,
    ) => Result<Reservation, ApplicationError>,
  ): Promise<Result<Reservation, ApplicationError>> {
    return this.write(() =>
      this.db.transaction(async (tx) => {
        const found = await this.lockEvent(tx, eventId)
        if (Option.isNone(found)) {
          return Result.fail(new NotFound('Event not found'))
        }
        const result = create(
          found.value,
          await this.reservedSeats(tx, eventId),
        )
        if (result._tag === 'Failure') {
          return result
        }
        await tx
          .insert(reservations)
          .values(reservationToRow(reservationToEntity(result.value)))
        return result
      }),
    )
  }

  async listReservations(userId: UserId) {
    const rows = await this.db
      .select()
      .from(reservations)
      .where(eq(reservations.userId, userId))
      .orderBy(asc(reservations.createdAt), asc(reservations.id))
    return rows.map((row) => reservationToDomain(reservationFromRow(row)))
  }

  async cancelReservation(
    id: ReservationId,
    userId: UserId,
    change: (reservation: Reservation) => Result<Reservation, ApplicationError>,
  ): Promise<Result<Reservation, ApplicationError>> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(reservations)
        .where(and(eq(reservations.id, id), eq(reservations.userId, userId)))
        .for('update')
      const found = Option.fromNullable(row)
      if (Option.isNone(found)) {
        return Result.fail(new NotFound('Reservation not found'))
      }
      const updated = change(
        reservationToDomain(reservationFromRow(found.value)),
      )
      if (updated._tag === 'Failure') {
        return updated
      }
      const { cancelledAt } = reservationToRow(
        reservationToEntity(updated.value),
      )
      await tx
        .update(reservations)
        .set({ cancelledAt })
        .where(eq(reservations.id, id))
      return updated
    })
  }

  async userExists(id: UserId) {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
    return rows.length > 0
  }

  private async lockEvent(
    tx: Transaction,
    id: EventId,
  ): Promise<Option<Event>> {
    const [row] = await tx
      .select()
      .from(events)
      .where(eq(events.id, id))
      .for('update')
    return Option.map(Option.fromNullable(row), eventToDomain)
  }

  private async reservedSeats(
    tx: Transaction,
    eventId: EventId,
  ): Promise<number> {
    const [row] = await tx
      .select({
        seats: sql<number>`coalesce(sum(${reservations.quantity}), 0)::int`,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.eventId, eventId),
          isNull(reservations.cancelledAt),
        ),
      )
    return row!.seats
  }

  private async write<Value>(
    operation: () => Promise<Result<Value, ApplicationError>>,
  ): Promise<Result<Value, ApplicationError>> {
    const result = await Result.tryPromise(operation, (cause) => {
      if (isForeignKeyViolation(cause)) {
        return new InvalidInput('Referenced venue or user does not exist')
      }
      // Lost connections, corrupt SQL and driver faults are not business failures.
      throw cause
    })
    return result._tag === 'Failure' ? result : result.value
  }
}

// Drizzle wraps driver errors in DrizzleQueryError. Bun puts the SQLSTATE in
// errno; its code holds Bun's own error code.
function isForeignKeyViolation(error: unknown) {
  const cause = error instanceof DrizzleQueryError ? error.cause : error
  return cause instanceof SQL.PostgresError && cause.errno === '23503'
}
