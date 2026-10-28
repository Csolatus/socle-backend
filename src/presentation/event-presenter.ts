import * as v from 'valibot'
import { Option } from '#/shared-kernel/option.ts'
import type { Event } from '#/domain/event.ts'
import type { Reservation } from '#/domain/reservation.ts'
import {
  errorDtoSchema,
  eventDtoSchema,
  reservationDtoSchema,
  type ErrorDto,
  type EventDto,
  type ReservationDto,
} from '#/presentation/dtos.ts'

export function presentEvent(event: Event): EventDto {
  return v.parse(eventDtoSchema, {
    id: event.data.id,
    title: event.data.title,
    category: event.data.category,
    startsAt: event.data.startsAt.toISOString(),
    capacity: event.data.capacity,
    venueId: event.data.venueId,
  })
}

export function presentReservation(reservation: Reservation): ReservationDto {
  return v.parse(reservationDtoSchema, {
    id: reservation.data.id,
    eventId: reservation.data.eventId,
    userId: reservation.data.userId,
    quantity: reservation.data.quantity,
    createdAt: reservation.data.createdAt.toISOString(),
    cancelledAt: Option.isSome(reservation.data.cancelledAt)
      ? reservation.data.cancelledAt.value.toISOString()
      : null,
  })
}

export function presentError(code: string, message: string): ErrorDto {
  return v.parse(errorDtoSchema, { error: { code, message } })
}
