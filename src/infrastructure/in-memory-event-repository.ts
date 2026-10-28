import type {
  ApplicationError,
  EventFilter,
  EventRepository,
} from '#/application/ports.ts'
import type { Event } from '#/domain/event.ts'
import type { Reservation } from '#/domain/reservation.ts'
import type { EventId, ReservationId, UserId, VenueId } from '#/domain/ids.ts'
import { InvalidInput, NotFound } from '#/domain/errors.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'

export class InMemoryEventRepository implements EventRepository {
  private readonly events = new Map<EventId, Event>()
  private readonly reservations = new Map<ReservationId, Reservation>()

  constructor(
    private readonly references: {
      users: ReadonlySet<UserId>
      venues: ReadonlySet<VenueId>
    },
  ) {}

  async listEvents(filter: EventFilter) {
    return [...this.events.values()]
      .filter(
        ({ data }) =>
          (filter.category === undefined ||
            data.category === filter.category) &&
          (filter.after === undefined || data.startsAt > filter.after),
      )
      .sort(
        (a, b) =>
          a.data.startsAt.getTime() - b.data.startsAt.getTime() ||
          a.data.id.localeCompare(b.data.id),
      )
  }

  async findEvent(id: EventId): Promise<Option<Event>> {
    return Option.fromNullable(this.events.get(id))
  }

  async createEvent(event: Event): Promise<Result<Event, ApplicationError>> {
    if (!this.references.venues.has(event.data.venueId)) {
      return Result.fail(
        new InvalidInput('Referenced venue or user does not exist'),
      )
    }
    if (this.events.has(event.data.id)) {
      throw new Error('Duplicate event ID')
    }
    this.events.set(event.data.id, event)
    return Result.succeed(event)
  }

  async updateEvent(
    id: EventId,
    change: (
      event: Event,
      reservedSeats: number,
    ) => Result<Event, ApplicationError>,
  ): Promise<Result<Event, ApplicationError>> {
    const found = Option.fromNullable(this.events.get(id))
    if (Option.isNone(found)) {
      return Result.fail(new NotFound('Event not found'))
    }
    const changed = change(found.value, this.reservedSeats(id))
    if (changed._tag === 'Failure') {
      return changed
    }
    if (!this.references.venues.has(changed.value.data.venueId)) {
      return Result.fail(
        new InvalidInput('Referenced venue or user does not exist'),
      )
    }
    this.events.set(id, changed.value)
    return changed
  }

  // No await between reading capacity and writing: each mutation is atomic within
  // one JS event-loop turn. This fake does not simulate PostgreSQL row locks.
  async reserve(
    eventId: EventId,
    create: (
      event: Event,
      reservedSeats: number,
    ) => Result<Reservation, ApplicationError>,
  ): Promise<Result<Reservation, ApplicationError>> {
    const found = Option.fromNullable(this.events.get(eventId))
    if (Option.isNone(found)) {
      return Result.fail(new NotFound('Event not found'))
    }
    const result = create(found.value, this.reservedSeats(eventId))
    if (result._tag === 'Failure') {
      return result
    }
    if (!this.references.users.has(result.value.data.userId)) {
      return Result.fail(
        new InvalidInput('Referenced venue or user does not exist'),
      )
    }
    if (this.reservations.has(result.value.data.id)) {
      throw new Error('Duplicate reservation ID')
    }
    this.reservations.set(result.value.data.id, result.value)
    return result
  }

  async listReservations(userId: UserId) {
    return [...this.reservations.values()]
      .filter(({ data }) => data.userId === userId)
      .sort(
        (a, b) =>
          a.data.createdAt.getTime() - b.data.createdAt.getTime() ||
          a.data.id.localeCompare(b.data.id),
      )
  }

  async cancelReservation(
    id: ReservationId,
    userId: UserId,
    change: (reservation: Reservation) => Result<Reservation, ApplicationError>,
  ): Promise<Result<Reservation, ApplicationError>> {
    const found = Option.fromNullable(this.reservations.get(id))
    if (Option.isNone(found) || found.value.data.userId !== userId) {
      return Result.fail(new NotFound('Reservation not found'))
    }
    const changed = change(found.value)
    if (changed._tag === 'Success') {
      this.reservations.set(id, changed.value)
    }
    return changed
  }

  async userExists(id: UserId) {
    return this.references.users.has(id)
  }

  private reservedSeats(id: EventId) {
    return [...this.reservations.values()]
      .filter(
        ({ data }) => data.eventId === id && Option.isNone(data.cancelledAt),
      )
      .reduce((total, { data }) => total + data.quantity, 0)
  }
}
