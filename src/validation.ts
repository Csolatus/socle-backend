import * as v from 'valibot'
import { Result } from '#/shared-kernel/result.ts'
import { InvalidInput } from '#/domain/errors.ts'
import {
  EventId,
  ReservationId,
  UserId,
  VenueId,
  uuidV7Pattern,
} from '#/domain/ids.ts'

export const uuidSchema = v.pipe(
  v.string(),
  v.regex(uuidV7Pattern, 'Expected a lowercase UUID v7'),
)
export const eventIdSchema = v.pipe(
  uuidSchema,
  v.transform((value: string) => EventId.makeUnsafe(value)),
)
export const userIdSchema = v.pipe(
  uuidSchema,
  v.transform((value: string) => UserId.makeUnsafe(value)),
)
export const venueIdSchema = v.pipe(
  uuidSchema,
  v.transform((value: string) => VenueId.makeUnsafe(value)),
)
export const reservationIdSchema = v.pipe(
  uuidSchema,
  v.transform((value: string) => ReservationId.makeUnsafe(value)),
)
const textSchema = v.pipe(
  v.string(),
  v.trim(),
  v.nonEmpty('Expected non-empty text'),
)
export const dateSchema = v.pipe(
  v.string(),
  v.isoTimestamp('Expected an ISO date-time with a timezone'),
  v.transform((value) => new Date(value)),
  v.check((value) => Number.isFinite(value.getTime()), 'Invalid date-time'),
)
const positiveIntegerSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(1),
  v.maxValue(2147483647),
)

export const createEventSchema = v.strictObject({
  title: textSchema,
  category: textSchema,
  startsAt: dateSchema,
  capacity: positiveIntegerSchema,
  venueId: venueIdSchema,
})
export const updateEventSchema = v.pipe(
  v.partial(createEventSchema),
  v.check((value) => Object.keys(value).length > 0, 'Patch must not be empty'),
)
export const eventFilterSchema = v.strictObject({
  category: v.optional(textSchema),
  after: v.optional(dateSchema),
})
export const reservationSchema = v.strictObject({
  quantity: positiveIntegerSchema,
})

export function parse<T extends v.GenericSchema>(
  schema: T,
  input: unknown,
): Result<v.InferOutput<T>, InvalidInput> {
  const result = v.safeParse(schema, input)
  if (!result.success) {
    return Result.fail(
      new InvalidInput(result.issues.map((issue) => issue.message).join('; ')),
    )
  }
  return Result.succeed(result.output)
}
