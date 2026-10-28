import { Conflict } from '#/domain/errors.ts'
import type { EventId, ReservationId, UserId } from '#/domain/ids.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'

export interface ReservationData {
  id: ReservationId
  eventId: EventId
  userId: UserId
  quantity: number
  createdAt: Date
  cancelledAt: Option<Date>
}

export class Reservation {
  constructor(readonly data: Readonly<ReservationData>) {}

  cancel(now: Date): Result<Reservation, Conflict> {
    if (Option.isSome(this.data.cancelledAt)) {
      return Result.fail(new Conflict('Reservation is already cancelled'))
    }
    return Result.succeed(
      new Reservation({ ...this.data, cancelledAt: Option.some(now) }),
    )
  }
}
