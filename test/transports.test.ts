import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { fakeText } from '@tanstack/ai/testing'
import { EventSourceParserStream } from 'eventsource-parser/stream'
import * as v from 'valibot'
import { createApp } from '#/app.ts'
import { createServices } from '#/application/services.ts'
import { InMemoryEventRepository } from '#/infrastructure/in-memory-event-repository.ts'
import { UserId, VenueId, EventId } from '#/domain/ids.ts'
import { Option } from '#/shared-kernel/option.ts'
import {
  errorDtoSchema,
  eventDtoSchema,
  reservationDtoSchema,
} from '#/presentation/dtos.ts'
import { given } from './support/given.ts'
import { requestChat, type ToolActivity } from '#/chat/client-stream.ts'

const alice = UserId.makeUnsafe('01900000-0000-7000-8000-000000000001')
const bob = UserId.makeUnsafe('01900000-0000-7000-8000-000000000002')
const venueId = VenueId.makeUnsafe('01900000-0000-7000-8000-000000000003')
const repository = new InMemoryEventRepository({
  users: new Set([alice, bob]),
  venues: new Set([venueId]),
})
let server: ReturnType<typeof Bun.serve>
let url: string
const clients: Client[] = []

beforeAll(() => {
  const app = createApp(
    createServices(repository, { now: () => new Date('2030-01-01T00:00:00Z') }),
    {
      mcpUrl: () => `${url}/mcp`,
      adapter: () => {
        const adapter = fakeText()
        adapter.setResponses([
          ({ request }) => ({
            toolCalls: request.messages.some(
              (message) =>
                message.role === 'user' && message.content === 'List events',
            )
              ? [
                  {
                    name: 'list_events',
                    input: { after: null, category: null },
                  },
                ]
              : [{ name: 'list_my_reservations', input: {} }],
          }),
          ({ request }) => {
            const result = request.messages.findLast(
              (message) => message.role === 'tool',
            )
            return result
              ? { text: JSON.stringify(result.content) }
              : { error: 'Tool did not execute' }
          },
        ])
        return adapter
      },
    },
  )
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch })
  url = server.url.origin
})
afterAll(async () => {
  await Promise.all(clients.map((client) => client.close()))
  await server.stop(true)
})

async function connect(userId?: UserId) {
  const client = new Client({ name: 'test', version: '1.0.0' })
  clients.push(client)
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
      requestInit: { headers: userId ? { 'X-User-Id': userId } : {} },
    }),
  )
  return client
}
async function anEvent(capacity = 1) {
  const client = await connect(alice)
  const result = await client.callTool({
    name: 'create_event',
    arguments: {
      title: 'Test event',
      category: 'testing',
      startsAt: '2099-06-15T18:00:00Z',
      capacity,
      venueId,
    },
  })
  return { client, event: v.parse(eventDtoSchema, result.structuredContent) }
}
function toolError(result: Awaited<ReturnType<Client['callTool']>>) {
  const failure = v.parse(
    v.object({
      isError: v.literal(true),
      content: v.pipe(
        v.array(v.object({ type: v.literal('text'), text: v.string() })),
        v.minLength(1),
      ),
    }),
    result,
  )
  return v.parse(errorDtoSchema, JSON.parse(failure.content[0]!.text)).error
}
async function http(
  method: string,
  path: string,
  body?: unknown,
  userId?: string,
) {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(userId ? { 'X-User-Id': userId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  }
}
async function aReservation() {
  const fixture = await anEvent(2)
  const response = await http(
    'POST',
    `/events/${fixture.event.id}/reservations`,
    { quantity: 2 },
    alice,
  )
  return {
    ...fixture,
    reservation: v.parse(reservationDtoSchema, response.body),
  }
}

test('UI receives list_events results when OpenRouter sends null optional filters', () =>
  given(anEvent)
    .when(async () => {
      const text: string[] = []
      const tools: ToolActivity[] = []
      const outcome = await requestChat(
        'List events',
        new AbortController().signal,
        {
          onText: (delta) => {
            text.push(delta)
          },
          onTool: (activity) => {
            tools.push(activity)
          },
        },
        (_path, init) => fetch(`${url}/chat`, init),
      )
      return { outcome, text: text.join(''), tools }
    })
    .then(({ outcome, text, tools }, { event }) => {
      expect(outcome._tag).toBe('Success')
      expect(
        tools.some(
          (tool) => tool.phase === 'started' && tool.name === 'list_events',
        ),
      ).toBe(true)
      const results = tools.filter((tool) => tool.phase === 'result')
      expect(results).toHaveLength(1)
      expect(results[0]!.detail).toContain(event.id)
      expect(text).toContain(event.id)
    }))

test('discovery exposes all seven MCP tool schemas', () =>
  given(connect)
    .when((client) => client.listTools())
    .then(({ tools }) => {
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        'cancel_reservation',
        'create_event',
        'get_event',
        'list_events',
        'list_my_reservations',
        'reserve_event',
        'update_event',
      ])
      expect(tools.every((tool) => tool.inputSchema.type === 'object')).toBe(
        true,
      )
      // Multiple UUID patterns used to serialize as allOf, disabling strict mode.
      for (const tool of tools) {
        expect(JSON.stringify(tool.inputSchema)).not.toContain('"allOf"')
        expect(JSON.stringify(tool.outputSchema)).not.toContain('"allOf"')
      }
    }))

test('MCP writes are visible in REST and MCP reads', () =>
  given(anEvent)
    .when(async ({ client, event }) => {
      const updated = await client.callTool({
        name: 'update_event',
        arguments: { eventId: event.id, patch: { title: 'Changed' } },
      })
      const rest = await http('GET', `/events/${event.id}`)
      const get = await client.callTool({
        name: 'get_event',
        arguments: { eventId: event.id },
      })
      const list = await client.callTool({
        name: 'list_events',
        arguments: { category: 'testing' },
      })
      return { updated, rest, get, list }
    })
    .then(({ updated, rest, get, list }, { event }) => {
      const expected = { ...event, title: 'Changed' }
      expect(updated.structuredContent).toEqual(expected)
      expect(rest.status).toBe(200)
      expect(rest.body).toEqual(expected)
      expect(get.structuredContent).toEqual(expected)
      expect(
        v.parse(
          v.object({ events: v.array(eventDtoSchema) }),
          list.structuredContent,
        ).events,
      ).toContainEqual(expected)
    }))

test('concurrent reservations cannot claim the same last seat in the fake', () =>
  given(anEvent)
    .when(async ({ client, event }) => {
      const other = await connect(bob)
      return Promise.all(
        [client, other].map((connection) =>
          connection.callTool({
            name: 'reserve_event',
            arguments: { eventId: event.id, quantity: 1 },
          }),
        ),
      )
    })
    .then(async (results, { event }) => {
      expect(results.filter((result) => !result.isError)).toHaveLength(1)
      const failures = results.filter((result) => result.isError)
      expect(failures).toHaveLength(1)
      expect(toolError(failures[0]!)).toEqual({
        code: 'CONFLICT',
        message: 'Not enough seats',
      })
      const all = [
        ...(await repository.listReservations(alice)),
        ...(await repository.listReservations(bob)),
      ]
      expect(all.filter(({ data }) => data.eventId === event.id)).toHaveLength(
        1,
      )
    }))

test.each([
  {
    name: 'malformed ID',
    tool: 'reserve_event',
    arguments: { eventId: 'invalid', quantity: 1 },
    reason: 'Invalid arguments for tool reserve_event',
  },
  {
    name: 'UUID v4 reservation ID',
    tool: 'cancel_reservation',
    arguments: { reservationId: '44444444-4444-4444-8444-444444444444' },
    reason: 'Invalid arguments for tool cancel_reservation',
  },
  {
    name: 'uppercase UUID v7 reservation ID',
    tool: 'cancel_reservation',
    arguments: { reservationId: '01900000-0000-7000-8000-00000000000A' },
    reason: 'Invalid arguments for tool cancel_reservation',
  },
  {
    name: 'null required reservation ID',
    tool: 'cancel_reservation',
    arguments: { reservationId: null },
    reason: 'Invalid arguments for tool cancel_reservation',
  },
  {
    name: 'unknown tool',
    tool: 'unknown_tool',
    arguments: {},
    reason: 'Tool unknown_tool not found',
  },
])(
  'McpServer reports $name as a tool failure without rejecting the call',
  (scenario) =>
    given(connect)
      .when((client) =>
        client.callTool({ name: scenario.tool, arguments: scenario.arguments }),
      )
      .then((result) => {
        expect(result.isError).toBe(true)
        expect(JSON.stringify(result.content)).toContain(scenario.reason)
      }),
)

test('missing identity is a resolved unauthorized tool result', () =>
  given(connect)
    .when((client) =>
      client.callTool({ name: 'list_my_reservations', arguments: {} }),
    )
    .then((result) => {
      expect(toolError(result)).toEqual({
        code: 'UNAUTHORIZED',
        message: 'A known X-User-Id is required for this demo',
      })
    }))

test('MCP cancellation enforces ownership, records a timestamp, and releases seats', () =>
  given(aReservation)
    .when(async ({ client, event, reservation }) => {
      const other = await connect(bob)
      const denied = await other.callTool({
        name: 'cancel_reservation',
        arguments: { reservationId: reservation.id },
      })
      const cancelled = await client.callTool({
        name: 'cancel_reservation',
        arguments: { reservationId: reservation.id },
      })
      const repeated = await client.callTool({
        name: 'cancel_reservation',
        arguments: { reservationId: reservation.id },
      })
      const next = await other.callTool({
        name: 'reserve_event',
        arguments: { eventId: event.id, quantity: 2 },
      })
      return { denied, cancelled, repeated, next }
    })
    .then(({ denied, cancelled, repeated, next }, { reservation }) => {
      expect(toolError(denied).code).toBe('NOT_FOUND')
      expect(
        v.parse(reservationDtoSchema, cancelled.structuredContent),
      ).toEqual({ ...reservation, cancelledAt: '2030-01-01T00:00:00.000Z' })
      expect(toolError(repeated).code).toBe('CONFLICT')
      expect(next.isError).not.toBe(true)
    }))

test('REST failed writes leave capacity and reservations unchanged', () =>
  given(aReservation)
    .when(async ({ event }) => ({
      overbooked: await http(
        'POST',
        `/events/${event.id}/reservations`,
        { quantity: 1 },
        bob,
      ),
      lowered: await http('PATCH', `/events/${event.id}`, { capacity: 1 }),
      persisted: await http('GET', `/events/${event.id}`),
    }))
    .then(
      async ({ overbooked, lowered, persisted }, { event, reservation }) => {
        expect(overbooked.status).toBe(409)
        expect(lowered.status).toBe(409)
        expect(persisted.body).toEqual(event)
        const bookings = [
          ...(await repository.listReservations(alice)),
          ...(await repository.listReservations(bob)),
        ].filter(({ data }) => data.eventId === event.id)
        expect(bookings.map(({ data }) => String(data.id))).toEqual([
          reservation.id,
        ])
      },
    ))

test('REST cancellation preserves Option state and hides other users bookings', () =>
  given(aReservation)
    .when(async ({ reservation }) => ({
      denied: await http(
        'POST',
        `/reservations/${reservation.id}/cancellation`,
        undefined,
        bob,
      ),
      cancelled: await http(
        'POST',
        `/reservations/${reservation.id}/cancellation`,
        undefined,
        alice,
      ),
      repeated: await http(
        'POST',
        `/reservations/${reservation.id}/cancellation`,
        undefined,
        alice,
      ),
      listed: await http('GET', '/me/reservations', undefined, alice),
    }))
    .then(async ({ denied, cancelled, repeated, listed }, { reservation }) => {
      expect(reservation.cancelledAt).toBeNull()
      expect(denied.status).toBe(404)
      expect(cancelled.status).toBe(200)
      expect(repeated.status).toBe(409)
      const expected = {
        ...reservation,
        cancelledAt: '2030-01-01T00:00:00.000Z',
      }
      expect(cancelled.body).toEqual(expected)
      expect(
        v.parse(v.array(reservationDtoSchema), listed.body),
      ).toContainEqual(expected)
      const stored = (await repository.listReservations(alice)).find(
        ({ data }) => data.id === reservation.id,
      )!
      expect(stored.data.cancelledAt).toEqual(
        Option.some(new Date('2030-01-01T00:00:00Z')),
      )
    }))

test.each([
  {
    name: 'invalid ID',
    path: '/events/invalid',
    status: 400,
    code: 'INVALID_INPUT',
  },
  {
    name: 'UUID v4',
    path: `/events/${crypto.randomUUID()}`,
    status: 400,
    code: 'INVALID_INPUT',
  },
  {
    name: 'missing event',
    path: `/events/${EventId.make()}`,
    status: 404,
    code: 'NOT_FOUND',
  },
  {
    name: 'invalid date',
    path: '/events?after=invalid',
    status: 400,
    code: 'INVALID_INPUT',
  },
  {
    name: 'missing identity',
    path: '/me/reservations',
    status: 401,
    code: 'UNAUTHORIZED',
  },
])('REST maps $name to its status and error DTO', (scenario) =>
  given(() => scenario)
    .when(({ path }) => http('GET', path))
    .then((response, expected) => {
      expect(response.status).toBe(expected.status)
      expect(v.parse(errorDtoSchema, response.body).error.code).toBe(
        expected.code,
      )
    }),
)

test('malformed JSON returns a specific validation failure', () =>
  given(() => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  }))
    .when((request) => fetch(`${url}/events`, request))
    .then(async (response) => {
      expect(response.status).toBe(400)
      expect(v.parse(errorDtoSchema, await response.json()).error).toEqual({
        code: 'INVALID_INPUT',
        message: 'Request body must be valid JSON',
      })
    }))

test('chat uses real MCP with Alice identity and completes SSE without a provider key', () =>
  given(async () => {
    const own = await aReservation()
    const other = await connect(bob)
    const event = await anEvent()
    const result = await other.callTool({
      name: 'reserve_event',
      arguments: { eventId: event.event.id, quantity: 1 },
    })
    return {
      ownId: own.reservation.id,
      otherId: v.parse(reservationDtoSchema, result.structuredContent).id,
    }
  })
    .when(async () => {
      const response = await fetch(`${url}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': alice },
        body: JSON.stringify({ message: 'Show my reservations' }),
      })
      const reader = response
        .body!.pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream())
        .getReader()
      const events: { type: string }[] = []
      let text = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) {
          break
        }
        if (value.data !== '[DONE]') {
          text += value.data
          events.push(
            v.parse(v.object({ type: v.string() }), JSON.parse(value.data)),
          )
        }
      }
      return { response, events, text }
    })
    .then(({ response, events, text }, { ownId, otherId }) => {
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toContain(
        'text/event-stream',
      )
      expect(events.some((event) => event.type === 'RUN_ERROR')).toBe(false)
      expect(events.some((event) => event.type === 'TOOL_CALL_RESULT')).toBe(
        true,
      )
      expect(events.at(-1)?.type).toBe('RUN_FINISHED')
      expect(text).toContain(ownId)
      expect(text).not.toContain(otherId)
    }))

test.each([
  {
    name: 'missing identity',
    body: { message: 'Hello' },
    user: undefined,
    status: 401,
  },
  { name: 'empty message', body: { message: '' }, user: alice, status: 400 },
  {
    name: 'forged identity',
    body: { message: 'Hello', userId: bob },
    user: alice,
    status: 400,
  },
])('chat rejects $name before opening SSE', (scenario) =>
  given(() => scenario)
    .when(({ body, user }) => http('POST', '/chat', body, user))
    .then((response, expected) => {
      expect(response.status).toBe(expected.status)
      expect(response.headers.get('Content-Type')).toContain('application/json')
    }),
)
