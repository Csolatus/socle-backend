import * as v from 'valibot'
import type { Services } from '#/application/services.ts'
import type { ApplicationError } from '#/application/ports.ts'
import type { UserId } from '#/domain/ids.ts'
import { Result } from '#/shared-kernel/result.ts'
import { defineTool } from '#/mcp/define-tool.ts'
import {
  presentEvent,
  presentReservation,
} from '#/presentation/event-presenter.ts'
import { eventDtoSchema, reservationDtoSchema } from '#/presentation/dtos.ts'
import {
  createEventSchema,
  updateEventSchema,
  eventFilterSchema,
  reservationSchema,
  eventIdSchema,
  reservationIdSchema,
} from '#/validation.ts'

type CurrentUser = () => Promise<Result<UserId, ApplicationError>>

export function createTools(services: Services, currentUser: CurrentUser) {
  return [
    defineTool({
      name: 'list_events',
      description:
        'List events, optionally filtered by category and exclusive start date.',
      input: v.strictObject({
        category: v.pipe(
          v.nullish(eventFilterSchema.entries.category),
          v.transform((value) => value ?? undefined),
        ),
        after: v.pipe(
          v.nullish(eventFilterSchema.entries.after),
          v.transform((value) => value ?? undefined),
        ),
      }),
      output: v.strictObject({ events: v.array(eventDtoSchema) }),
      readOnly: true,
      execute: async (input) =>
        Result.succeed({
          events: (await services.read.list(input)).map(presentEvent),
        }),
    }),
    defineTool({
      name: 'get_event',
      description: 'Read an event by its UUID.',
      input: v.strictObject({ eventId: eventIdSchema }),
      output: eventDtoSchema,
      readOnly: true,
      execute: async ({ eventId }) =>
        Result.map(await services.read.get(eventId), presentEvent),
    }),
    defineTool({
      name: 'create_event',
      description:
        'Create a future event at an existing venue. This writes to the database.',
      input: createEventSchema,
      output: eventDtoSchema,
      readOnly: false,
      execute: async (input) =>
        Result.map(await services.create.execute(input), presentEvent),
    }),
    defineTool({
      name: 'update_event',
      description:
        'Update a future event. Capacity cannot fall below active reservations.',
      input: v.strictObject({
        eventId: eventIdSchema,
        patch: updateEventSchema,
      }),
      output: eventDtoSchema,
      readOnly: false,
      execute: async ({ eventId, patch }) =>
        Result.map(await services.update.execute(eventId, patch), presentEvent),
    }),
    defineTool({
      name: 'reserve_event',
      description:
        'Reserve seats for the current request user. This creates a reservation.',
      input: v.strictObject({
        eventId: eventIdSchema,
        ...reservationSchema.entries,
      }),
      output: reservationDtoSchema,
      readOnly: false,
      execute: async (input) => {
        const user = await currentUser()
        if (user._tag === 'Failure') {
          return user
        }
        return Result.map(
          await services.reserve.execute({ ...input, userId: user.value }),
          presentReservation,
        )
      },
    }),
    defineTool({
      name: 'list_my_reservations',
      description:
        'List all reservations, including cancellations, for the current request user.',
      input: v.strictObject({}),
      output: v.strictObject({ reservations: v.array(reservationDtoSchema) }),
      readOnly: true,
      execute: async () => {
        const user = await currentUser()
        if (user._tag === 'Failure') {
          return user
        }
        return Result.succeed({
          reservations: (await services.read.reservationsFor(user.value)).map(
            presentReservation,
          ),
        })
      },
    }),
    defineTool({
      name: 'cancel_reservation',
      description:
        'Cancel a reservation owned by the current request user. This releases seats.',
      input: v.strictObject({ reservationId: reservationIdSchema }),
      output: reservationDtoSchema,
      readOnly: false,
      execute: async ({ reservationId }) => {
        const user = await currentUser()
        if (user._tag === 'Failure') {
          return user
        }
        return Result.map(
          await services.cancel.execute(reservationId, user.value),
          presentReservation,
        )
      },
    }),
  ]
}
