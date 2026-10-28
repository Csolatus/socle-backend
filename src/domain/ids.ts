import {
  validate as validateUuid,
  v7 as uuidV7,
  version as uuidVersion,
} from 'uuid'
import { Result } from '#/shared-kernel/result.ts'

declare const brand: unique symbol
export type Brand<Value, Name extends string> = Value & {
  readonly [brand]: Name
}
export type UserId = Brand<string, 'UserId'>
export type EventId = Brand<string, 'EventId'>
export type ReservationId = Brand<string, 'ReservationId'>
export type VenueId = Brand<string, 'VenueId'>

export const uuidV7Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export class InvalidIdError extends Error {
  constructor(
    readonly kind: string,
    readonly input: unknown,
  ) {
    super(`${kind} must be a UUID v7`)
    this.name = 'InvalidIdError'
  }
}

export const makeId = <Id>(): Id => uuidV7() as Id

const makeIdCompanion = <Id>(kind: string) => {
  const parse = (input: unknown): Result<Id, InvalidIdError> => {
    if (
      typeof input !== 'string' ||
      input !== input.toLowerCase() ||
      !validateUuid(input) ||
      uuidVersion(input) !== 7
    ) {
      return Result.fail(new InvalidIdError(kind, input))
    }
    return Result.succeed(input as Id)
  }
  const makeUnsafe = (input: unknown): Id => Result.getOrThrow(parse(input))
  return {
    make: (): Id => makeId<Id>(),
    parse,
    makeUnsafe,
    makeUnsafeNullable: (input: unknown): Id | null =>
      input === null || input === undefined ? null : makeUnsafe(input),
  }
}

export const UserId = makeIdCompanion<UserId>('UserId')
export const EventId = makeIdCompanion<EventId>('EventId')
export const ReservationId = makeIdCompanion<ReservationId>('ReservationId')
export const VenueId = makeIdCompanion<VenueId>('VenueId')
