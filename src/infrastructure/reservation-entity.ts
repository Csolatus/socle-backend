import * as v from 'valibot'
import { Reservation } from '#/domain/reservation.ts'
import { EventId, ReservationId, UserId } from '#/domain/ids.ts'
import { Option } from '#/shared-kernel/option.ts'

// Decode the nullable SQL column at the driver boundary. The entity uses Option.
export const reservationEntitySchema = v.strictObject({
  id: v.string(),
  event_id: v.string(),
  user_id: v.string(),
  quantity: v.number(),
  created_at: v.date(),
  cancelled_at: v.pipe(
    v.nullable(v.date()),
    v.transform((value) => Option.fromNullable(value)),
  ),
})
export type ReservationEntity = v.InferOutput<typeof reservationEntitySchema>

export function reservationToDomain(row: ReservationEntity): Reservation {
  return new Reservation({
    id: ReservationId.makeUnsafe(row.id),
    eventId: EventId.makeUnsafe(row.event_id),
    userId: UserId.makeUnsafe(row.user_id),
    quantity: row.quantity,
    createdAt: row.created_at,
    cancelledAt: row.cancelled_at,
  })
}

export function reservationToEntity(
  reservation: Reservation,
): ReservationEntity {
  const data = reservation.data
  return {
    id: data.id,
    event_id: data.eventId,
    user_id: data.userId,
    quantity: data.quantity,
    created_at: data.createdAt,
    cancelled_at: data.cancelledAt,
  }
}

export function reservationFromRow(row: unknown): Reservation {
  return reservationToDomain(v.parse(reservationEntitySchema, row))
}
