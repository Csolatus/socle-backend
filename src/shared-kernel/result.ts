export type Result<Value, Error> = Success<Value> | Failure<Error>

export interface Success<Value> {
  readonly _tag: 'Success'
  readonly value: Value
}
export interface Failure<Error> {
  readonly _tag: 'Failure'
  readonly error: Error
}

export const Result = {
  succeed: <Value>(value: Value): Success<Value> => ({
    _tag: 'Success',
    value,
  }),
  fail: <Error>(error: Error): Failure<Error> => ({ _tag: 'Failure', error }),
  map: <Value, Error, Next>(
    result: Result<Value, Error>,
    mapper: (value: Value) => Next,
  ): Result<Next, Error> =>
    result._tag === 'Success' ? Result.succeed(mapper(result.value)) : result,
  match: <Value, Error, Next>(
    result: Result<Value, Error>,
    cases: {
      onSuccess: (value: Value) => Next
      onFailure: (error: Error) => Next
    },
  ): Next =>
    result._tag === 'Success'
      ? cases.onSuccess(result.value)
      : cases.onFailure(result.error),
  // Adapt rejecting third-party/driver APIs once at their integration boundary.
  tryPromise: async <Value, Failure>(
    task: () => Promise<Value>,
    onError: (cause: unknown) => Failure,
  ): Promise<Result<Value, Failure>> => {
    try {
      return Result.succeed(await task())
    } catch (cause) {
      return Result.fail(onError(cause))
    }
  },
  // Unsafe constructors and persistence invariants only; never unwrap expected request failures.
  getOrThrow: <Value, Error>(result: Result<Value, Error>): Value => {
    if (result._tag === 'Failure') {
      throw result.error
    }
    return result.value
  },
} as const
