import type { Event } from '#/domain/event.ts'
import type { Reservation } from '#/domain/reservation.ts'
import type { EventId, ReservationId, UserId } from '#/domain/ids.ts'
import type {
  Conflict,
  InvalidInput,
  NotFound,
  Unauthorized,
} from '#/domain/errors.ts'
import type { Option } from '#/shared-kernel/option.ts'
import type { Result } from '#/shared-kernel/result.ts'

export type ApplicationError = Conflict | InvalidInput | NotFound | Unauthorized
export interface EventFilter {
  category?: string
  after?: Date
}

// Expected failures are values; infrastructure faults reject the promise.
// Mutation callbacks run under a lock. A Failure causes no write.
export interface EventRepository {
  listEvents(filter: EventFilter): Promise<Event[]>
  findEvent(id: EventId): Promise<Option<Event>>
  createEvent(event: Event): Promise<Result<Event, ApplicationError>>
  updateEvent(
    id: EventId,
    change: (
      event: Event,
      reservedSeats: number,
    ) => Result<Event, ApplicationError>,
  ): Promise<Result<Event, ApplicationError>>
  reserve(
    eventId: EventId,
    create: (
      event: Event,
      reservedSeats: number,
    ) => Result<Reservation, ApplicationError>,
  ): Promise<Result<Reservation, ApplicationError>>
  listReservations(userId: UserId): Promise<Reservation[]>
  cancelReservation(
    id: ReservationId,
    userId: UserId,
    change: (reservation: Reservation) => Result<Reservation, ApplicationError>,
  ): Promise<Result<Reservation, ApplicationError>>
  userExists(id: UserId): Promise<boolean>
}

export interface Clock {
  now(): Date
}
export interface IdGenerator {
  next<Id>(): Id
}
