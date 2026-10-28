export {}

const url =
  process.env.TEST_DATABASE_URL ??
  'postgres://events:events@localhost:55433/events_test'

const child = Bun.spawn(['bun', 'test', './test', ...Bun.argv.slice(2)], {
  env: { ...process.env, TEST_DATABASE_URL: url },
  stdio: ['inherit', 'inherit', 'inherit'],
})
process.exit(await child.exited)
