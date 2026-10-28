import { Reservation } from '#/domain/reservation.ts'
import type { EventId, ReservationId, UserId } from '#/domain/ids.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import type {
  Clock,
  EventRepository,
  IdGenerator,
} from '#/application/ports.ts'

export class ReserveEventHandler {
  constructor(
    private readonly repository: EventRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  execute(input: { eventId: EventId; userId: UserId; quantity: number }) {
    return this.repository.reserve(input.eventId, (event, seats) => {
      const now = this.clock.now()
      const checked = event.checkReservation(input.quantity, seats, now)
      if (checked._tag === 'Failure') {
        return checked
      }
      return Result.succeed(
        new Reservation({
          ...input,
          id: this.ids.next<ReservationId>(),
          createdAt: now,
          cancelledAt: Option.none(),
        }),
      )
    })
  }
}
