export type Option<Value> = None | Some<Value>

export interface None {
  readonly _tag: 'None'
}
export interface Some<Value> {
  readonly _tag: 'Some'
  readonly value: Value
}

const noneValue: None = Object.freeze({ _tag: 'None' })

export const Option = {
  none: <Value = never>(): Option<Value> => noneValue,
  some: <Value>(value: Value): Option<Value> => ({ _tag: 'Some', value }),
  fromNullable: <Value>(value: Value | null | undefined): Option<Value> =>
    value === null || value === undefined ? noneValue : { _tag: 'Some', value },
  isNone: <Value>(option: Option<Value>): option is None =>
    option._tag === 'None',
  isSome: <Value>(option: Option<Value>): option is Some<Value> =>
    option._tag === 'Some',
  map: <Value, Result>(
    option: Option<Value>,
    mapper: (value: Value) => Result,
  ): Option<Result> =>
    option._tag === 'Some'
      ? { _tag: 'Some', value: mapper(option.value) }
      : noneValue,
  match: <Value, Result>(
    option: Option<Value>,
    cases: {
      readonly onNone: () => Result
      readonly onSome: (value: Value) => Result
    },
  ): Result =>
    option._tag === 'Some' ? cases.onSome(option.value) : cases.onNone(),
} as const



function demo() {
  const demo1 = Option.some("value")
  if (Option.isSome(demo1)) {
    const v = demo1.value

  }
}



