import type { EventFilter, EventRepository } from '#/application/ports.ts'
import type { EventId, UserId } from '#/domain/ids.ts'
import { NotFound } from '#/domain/errors.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'

export class ReadEvents {
  constructor(private readonly repository: EventRepository) {}

  list(filter: EventFilter) {
    return this.repository.listEvents(filter)
  }

  async get(id: EventId) {
    const event = await this.repository.findEvent(id)
    if (Option.isNone(event)) {
      return Result.fail(new NotFound('Event not found'))
    }
    return Result.succeed(event.value)
  }

  reservationsFor(userId: UserId) {
    return this.repository.listReservations(userId)
  }
}
