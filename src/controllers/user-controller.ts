import type { Context } from 'hono'
import type { Services } from '#/application/services.ts'
import { httpFailure } from '#/controllers/http-result.ts'
import { presentReservation } from '#/presentation/event-presenter.ts'
import { requestUser } from '#/request.ts'
import { Option } from '#/shared-kernel/option.ts'

export function createUserController({ read, identity }: Services) {
  return {
    reservations: async (context: Context) => {
      const user = await requestUser(
        identity,
        Option.fromNullable(context.req.header('X-User-Id')),
      )
      if (user._tag === 'Failure') {
        return httpFailure(context, user.error)
      }
      return context.json(
        (await read.reservationsFor(user.value)).map(presentReservation),
      )
    },
  }
}
export type UserController = ReturnType<typeof createUserController>
