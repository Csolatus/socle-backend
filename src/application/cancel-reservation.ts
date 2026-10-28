import type { Clock, EventRepository } from '#/application/ports.ts'
import type { ReservationId, UserId } from '#/domain/ids.ts'

export class CancelReservationHandler {
  constructor(
    private readonly repository: EventRepository,
    private readonly clock: Clock,
  ) {}

  execute(id: ReservationId, userId: UserId) {
    return this.repository.cancelReservation(id, userId, (reservation) =>
      reservation.cancel(this.clock.now()),
    )
  }
}
