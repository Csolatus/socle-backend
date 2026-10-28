import type { EventInput } from '#/domain/event.ts'
import type { EventId } from '#/domain/ids.ts'
import type { Clock, EventRepository } from '#/application/ports.ts'

export class UpdateEventHandler {
  constructor(
    private readonly repository: EventRepository,
    private readonly clock: Clock,
  ) {}

  execute(id: EventId, patch: Partial<EventInput>) {
    return this.repository.updateEvent(id, (event, seats) =>
      event.update(patch, seats, this.clock.now()),
    )
  }
}
