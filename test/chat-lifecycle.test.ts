import { afterEach, expect, test } from 'bun:test'
import { fakeText } from '@tanstack/ai/testing'
import { createMCPClient } from '@tanstack/ai-mcp'
import { createApp } from '#/app.ts'
import { createServices } from '#/application/services.ts'
import { InMemoryEventRepository } from '#/infrastructure/in-memory-event-repository.ts'
import { chatResponse } from '#/chat/run.ts'
import { given } from './support/given.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) {
    await close()
  }
})

async function anAcquiredClientWithAnAbortedRequest() {
  const repository = new InMemoryEventRepository({
    users: new Set(),
    venues: new Set(),
  })
  const app = createApp(createServices(repository), {
    mcpUrl: () => 'http://127.0.0.1:3000/mcp',
  })
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch })
  cleanup.push(async () => {
    await server.stop(true)
  })
  const mcp = await createMCPClient({
    transport: { type: 'http', url: `${server.url.origin}/mcp` },
  })
  const originalClose = mcp.close.bind(mcp)
  cleanup.unshift(originalClose)
  let closes = 0
  mcp.close = async () => {
    closes += 1
    await originalClose()
  }
  const abort = new AbortController()
  abort.abort()
  return {
    mcp,
    adapter: fakeText(),
    message: 'List events',
    signal: abort.signal,
    closes: () => closes,
  }
}

test('an already-aborted chat closes the MCP client even when its stream never starts', () =>
  given(anAcquiredClientWithAnAbortedRequest)
    .when(chatResponse)
    .then((response, fixture) => {
      expect(response.status).toBe(499)
      expect(fixture.closes()).toBe(1)
      expect(response.body).toBeNull()
    }))
