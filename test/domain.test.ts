import { expect, test } from 'bun:test'
import { Event } from '#/domain/event.ts'
import { Reservation } from '#/domain/reservation.ts'
import { EventId, VenueId, UserId, ReservationId } from '#/domain/ids.ts'
import { Conflict, InvalidInput } from '#/domain/errors.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import { given } from './support/given.ts'

const now = new Date('2030-01-01T12:00:00Z')
function aFutureEvent() {
  return Result.getOrThrow(
    Event.create({
      id: EventId.make(),
      title: 'Game night',
      category: 'gaming',
      startsAt: new Date('2030-01-02T18:00:00Z'),
      capacity: 10,
      venueId: VenueId.make(),
    }),
  )
}
function anActiveReservation() {
  return new Reservation({
    id: ReservationId.make(),
    eventId: EventId.make(),
    userId: UserId.make(),
    quantity: 2,
    createdAt: now,
    cancelledAt: Option.none(),
  })
}

test('the last available seats can be reserved without overbooking', () =>
  given(aFutureEvent)
    .when((event) => ({
      exact: event.checkReservation(2, 8, now),
      over: event.checkReservation(3, 8, now),
    }))
    .then(({ exact, over }) => {
      expect(exact._tag).toBe('Success')
      expect(over).toEqual(Result.fail(new Conflict('Not enough seats')))
    }))

test.each([0, 1.5, -1, 2147483648])(
  'invalid quantity %s is a value-level failure',
  (quantity) =>
    given(aFutureEvent)
      .when((event) => event.checkReservation(quantity, 0, now))
      .then((result) => {
        expect(result).toEqual(
          Result.fail(
            new InvalidInput('Quantity must be a positive 32-bit integer'),
          ),
        )
      }),
)

test('booking at the start boundary is a conflict', () =>
  given(aFutureEvent)
    .when((event) => event.checkReservation(1, 0, event.data.startsAt))
    .then((result) => {
      expect(result).toEqual(
        Result.fail(new Conflict('Event has already started')),
      )
    }))

test('capacity cannot fall below existing reservations and updates are immutable', () =>
  given(aFutureEvent)
    .when((event) => ({
      below: event.update({ capacity: 4 }, 5, now),
      exact: event.update({ capacity: 5 }, 5, now),
    }))
    .then(({ below, exact }, original) => {
      expect(below).toEqual(
        Result.fail(
          new Conflict(
            'Capacity cannot be lower than the number of reserved seats',
          ),
        ),
      )
      expect(Result.getOrThrow(exact).data.capacity).toBe(5)
      expect(original.data.capacity).toBe(10)
    }))

test('cancellation changes None to Some without mutating the active value', () =>
  given(anActiveReservation)
    .when((reservation) => reservation.cancel(now))
    .then((result, original) => {
      const cancelled = Result.getOrThrow(result)
      expect(cancelled.data.cancelledAt).toEqual(Option.some(now))
      expect(original.data.cancelledAt).toEqual(Option.none())
      expect(cancelled.cancel(now)).toEqual(
        Result.fail(new Conflict('Reservation is already cancelled')),
      )
    }))

test.each([
  '44444444-4444-4444-8444-444444444444',
  'invalid',
  '01900000-0000-7000-8000-00000000000A',
])('identifier %s is rejected', (id) =>
  given(() => id)
    .when(EventId.parse)
    .then((result) => {
      expect(result._tag).toBe('Failure')
    }),
)

test('generated UUID v7 IDs can be parsed', () =>
  given(EventId.make)
    .when(EventId.parse)
    .then((result, id) => {
      expect(result).toEqual(Result.succeed(id))
    }))
