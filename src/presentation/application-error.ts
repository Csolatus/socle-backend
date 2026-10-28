import type { ApplicationError } from '#/application/ports.ts'
import { Conflict, NotFound, Unauthorized } from '#/domain/errors.ts'
import { presentError } from '#/presentation/event-presenter.ts'

export function presentApplicationError(error: ApplicationError) {
  if (error instanceof Conflict) {
    return {
      status: 409,
      body: presentError('CONFLICT', error.message),
    } as const
  }
  if (error instanceof NotFound) {
    return {
      status: 404,
      body: presentError('NOT_FOUND', error.message),
    } as const
  }
  if (error instanceof Unauthorized) {
    return {
      status: 401,
      body: presentError('UNAUTHORIZED', error.message),
    } as const
  }
  return {
    status: 400,
    body: presentError('INVALID_INPUT', error.message),
  } as const
}
