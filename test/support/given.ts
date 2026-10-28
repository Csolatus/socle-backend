// Each stage receives the typed output of the preceding stage. Failures propagate
// to Bun's test runner; the helper does not catch or reinterpret assertions.
export function given<Fixture>(setup: () => Fixture | Promise<Fixture>) {
  return {
    when<Action>(act: (fixture: Fixture) => Action | Promise<Action>) {
      return {
        async then(
          assert: (action: Action, fixture: Fixture) => void | Promise<void>,
        ) {
          const fixture = await setup()
          const action = await act(fixture)
          await assert(action, fixture)
        },
      }
    },
  }
}
