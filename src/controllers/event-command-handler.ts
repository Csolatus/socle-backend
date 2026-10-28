import type { Context } from 'hono'
import type { Services } from '#/application/services.ts'
import type { EventInput } from '#/domain/event.ts'
import type { EventId, ReservationId } from '#/domain/ids.ts'
import { Option } from '#/shared-kernel/option.ts'
import { requestUser } from '#/request.ts'
import { httpFailure, httpResult } from '#/controllers/http-result.ts'
import {
  presentEvent,
  presentReservation,
} from '#/presentation/event-presenter.ts'

// HTTP writes. Each operation delegates to its command use case.
export function createEventCommandHandler({
  identity,
  create,
  update,
  reserve,
  cancel,
}: Pick<Services, 'identity' | 'create' | 'update' | 'reserve' | 'cancel'>) {
  const currentUser = (context: Context) =>
    requestUser(identity, Option.fromNullable(context.req.header('X-User-Id')))
  return {
    create: async (context: Context, input: EventInput) => {
      const result = await create.execute(input)
      if (result._tag === 'Success') {
        context.header('Location', `/events/${result.value.data.id}`)
      }
      return httpResult(context, result, presentEvent, 201)
    },
    update: async (context: Context, id: EventId, patch: Partial<EventInput>) =>
      httpResult(context, await update.execute(id, patch), presentEvent),
    reserve: async (context: Context, eventId: EventId, quantity: number) => {
      const user = await currentUser(context)
      if (user._tag === 'Failure') {
        return httpFailure(context, user.error)
      }
      return httpResult(
        context,
        await reserve.execute({ eventId, userId: user.value, quantity }),
        presentReservation,
        201,
      )
    },
    cancel: async (context: Context, id: ReservationId) => {
      const user = await currentUser(context)
      if (user._tag === 'Failure') {
        return httpFailure(context, user.error)
      }
      return httpResult(
        context,
        await cancel.execute(id, user.value),
        presentReservation,
      )
    },
  }
}
export type EventCommandHandler = ReturnType<typeof createEventCommandHandler>
