import type * as v from 'valibot'
import type { DemoIdentity } from '#/application/demo-identity.ts'
import type { ApplicationError } from '#/application/ports.ts'
import type { UserId } from '#/domain/ids.ts'
import { InvalidInput } from '#/domain/errors.ts'
import { parse, userIdSchema } from '#/validation.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'

export async function requestUser(
  identity: DemoIdentity,
  provided: Option<string>,
): Promise<Result<UserId, ApplicationError>> {
  if (Option.isNone(provided)) {
    return identity.requireUser(Option.none())
  }
  const parsed = parse(userIdSchema, provided.value)
  if (parsed._tag === 'Failure') {
    return parsed
  }
  return identity.requireUser(Option.some(parsed.value))
}

export async function requestJson<Schema extends v.GenericSchema>(
  request: Request,
  schema: Schema,
): Promise<Result<v.InferOutput<Schema>, InvalidInput>> {
  let input: unknown
  try {
    input = await request.json()
  } catch {
    return Result.fail(new InvalidInput('Request body must be valid JSON'))
  }
  return parse(schema, input)
}
