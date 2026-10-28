import * as v from 'valibot'
import { uuidV7Pattern } from '#/domain/ids.ts'

// Response schemas validate serialized JSON, not domain Date objects.
const identifier = v.pipe(v.string(), v.regex(uuidV7Pattern))
const timestamp = v.pipe(v.string(), v.isoTimestamp())
const positiveInteger = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(1),
  v.maxValue(2147483647),
)

const nonEmptyText = v.pipe(
  v.string(),
  v.check((value) => value.trim().length > 0, 'Expected non-empty text'),
)

export const eventDtoSchema = v.strictObject({
  id: identifier,
  title: nonEmptyText,
  category: nonEmptyText,
  startsAt: timestamp,
  capacity: positiveInteger,
  venueId: identifier,
})

export const reservationDtoSchema = v.strictObject({
  id: identifier,
  eventId: identifier,
  userId: identifier,
  quantity: positiveInteger,
  createdAt: timestamp,
  cancelledAt: v.nullable(timestamp),
})

export const errorDtoSchema = v.strictObject({
  error: v.strictObject({
    code: nonEmptyText,
    message: nonEmptyText,
  }),
})

export type EventDto = v.InferOutput<typeof eventDtoSchema>
export type ReservationDto = v.InferOutput<typeof reservationDtoSchema>
export type ErrorDto = v.InferOutput<typeof errorDtoSchema>
