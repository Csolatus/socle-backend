import { Conflict, InvalidInput } from '#/domain/errors.ts'
import type { EventId, VenueId } from '#/domain/ids.ts'
import { Result } from '#/shared-kernel/result.ts'

export interface EventData {
  id: EventId
  title: string
  category: string
  startsAt: Date
  capacity: number
  venueId: VenueId
}
export type EventInput = Omit<EventData, 'id'>

export class Event {
  private constructor(readonly data: Readonly<EventData>) {}

  static create(data: EventData): Result<Event, InvalidInput> {
    if (!data.title.trim() || !data.category.trim()) {
      return Result.fail(
        new InvalidInput('Title and category must not be empty'),
      )
    }
    if (!Number.isFinite(data.startsAt.getTime())) {
      return Result.fail(new InvalidInput('Invalid start date'))
    }
    if (
      !Number.isInteger(data.capacity) ||
      data.capacity < 1 ||
      data.capacity > 2147483647
    ) {
      return Result.fail(
        new InvalidInput('Capacity must be a positive 32-bit integer'),
      )
    }
    return Result.succeed(new Event(data))
  }

  update(
    patch: Partial<EventInput>,
    reservedSeats: number,
    now: Date,
  ): Result<Event, Conflict | InvalidInput> {
    const result = Event.create({ ...this.data, ...patch })
    if (result._tag === 'Failure') {
      return result
    }
    const updated = result.value
    if (this.data.startsAt <= now || updated.data.startsAt <= now) {
      return Result.fail(new Conflict('Only future events can be updated'))
    }
    if (updated.data.capacity < reservedSeats) {
      return Result.fail(
        new Conflict(
          'Capacity cannot be lower than the number of reserved seats',
        ),
      )
    }
    return Result.succeed(updated)
  }

  checkReservation(
    quantity: number,
    reservedSeats: number,
    now: Date,
  ): Result<void, InvalidInput | Conflict> {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 2147483647) {
      return Result.fail(
        new InvalidInput('Quantity must be a positive 32-bit integer'),
      )
    }
    if (this.data.startsAt <= now) {
      return Result.fail(new Conflict('Event has already started'))
    }
    if (reservedSeats + quantity > this.data.capacity) {
      return Result.fail(new Conflict('Not enough seats'))
    }
    return Result.succeed(undefined)
  }
}
