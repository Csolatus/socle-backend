import { Reservation } from '#/domain/reservation.ts'
import { EventId, ReservationId, UserId } from '#/domain/ids.ts'
import type { reservations } from '#/infrastructure/schema.ts'
import { Option } from '#/shared-kernel/option.ts'

/** A row in the PostgreSQL reservations table, as inferred from the Drizzle schema. */
export type ReservationRow = typeof reservations.$inferSelect

// The entity uses Option. NULL only exists in the row, at the driver boundary.
export type ReservationEntity = Omit<ReservationRow, 'cancelledAt'> & {
  cancelledAt: Option<Date>
}

export function reservationFromRow(row: ReservationRow): ReservationEntity {
  return { ...row, cancelledAt: Option.fromNullable(row.cancelledAt) }
}

export function reservationToRow(entity: ReservationEntity): ReservationRow {
  return {
    ...entity,
    cancelledAt: Option.match(entity.cancelledAt, {
      onNone: () => null,
      onSome: (cancelledAt) => cancelledAt,
    }),
  }
}

export function reservationToDomain(entity: ReservationEntity): Reservation {
  return new Reservation({
    id: ReservationId.makeUnsafe(entity.id),
    eventId: EventId.makeUnsafe(entity.eventId),
    userId: UserId.makeUnsafe(entity.userId),
    quantity: entity.quantity,
    createdAt: entity.createdAt,
    cancelledAt: entity.cancelledAt,
  })
}

export function reservationToEntity(
  reservation: Reservation,
): ReservationEntity {
  const data = reservation.data
  return {
    id: data.id,
    eventId: data.eventId,
    userId: data.userId,
    quantity: data.quantity,
    createdAt: data.createdAt,
    cancelledAt: data.cancelledAt,
  }
}
