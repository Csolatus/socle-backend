import type { Context } from 'hono'
import type { ApplicationError } from '#/application/ports.ts'
import { presentApplicationError } from '#/presentation/application-error.ts'
import type { Result } from '#/shared-kernel/result.ts'

export function httpFailure(context: Context, error: ApplicationError) {
  const { body, status } = presentApplicationError(error)
  return context.json(body, status)
}

export function httpResult<Value>(
  context: Context,
  result: Result<Value, ApplicationError>,
  present: (value: Value) => object,
  status: 200 | 201 = 200,
) {
  if (result._tag === 'Failure') {
    return httpFailure(context, result.error)
  }
  return context.json(present(result.value), status)
}
