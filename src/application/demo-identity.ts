import { Unauthorized } from '#/domain/errors.ts'
import type { UserId } from '#/domain/ids.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import type { EventRepository } from '#/application/ports.ts'

export class DemoIdentity {
  constructor(private readonly repository: EventRepository) {}

  async requireUser(id: Option<UserId>): Promise<Result<UserId, Unauthorized>> {
    if (Option.isNone(id) || !(await this.repository.userExists(id.value))) {
      return Result.fail(
        new Unauthorized('A known X-User-Id is required for this demo'),
      )
    }
    return Result.succeed(id.value)
  }
}
