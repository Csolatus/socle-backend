import { CreateEventHandler } from '#/application/create-event.ts'
import { UpdateEventHandler } from '#/application/update-event.ts'
import { ReserveEventHandler } from '#/application/reserve-event.ts'
import { CancelReservationHandler } from '#/application/cancel-reservation.ts'
import { ReadEvents } from '#/application/read-events.ts'
import { DemoIdentity } from '#/application/demo-identity.ts'
import { makeId } from '#/domain/ids.ts'
import type {
  Clock,
  EventRepository,
  IdGenerator,
} from '#/application/ports.ts'

export function createServices(
  repository: EventRepository,
  clock: Clock = { now: () => new Date() },
  ids: IdGenerator = { next: makeId },
) {
  return {
    read: new ReadEvents(repository),
    identity: new DemoIdentity(repository),
    create: new CreateEventHandler(repository, clock, ids),
    update: new UpdateEventHandler(repository, clock),
    reserve: new ReserveEventHandler(repository, clock, ids),
    cancel: new CancelReservationHandler(repository, clock),
  }
}

export type Services = ReturnType<typeof createServices>
