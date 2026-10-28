import { expect, test } from 'bun:test'
import { createApp } from '#/app.ts'
import { createServices } from '#/application/services.ts'
import { InMemoryEventRepository } from '#/infrastructure/in-memory-event-repository.ts'
import {
  aliceUserId,
  requestChat,
  type ToolActivity,
} from '#/chat/client-stream.ts'

const encode = (text: string) => new TextEncoder().encode(text)
const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
const finished = event({ type: 'RUN_FINISHED' })

function givenStreamResponse(chunks: Uint8Array[]) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk)
        }
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}

function givenChatResponse(response: Response) {
  const text: string[] = []
  const tools: ToolActivity[] = []
  const requests: { input: string; init: RequestInit }[] = []
  return {
    text,
    tools,
    requests,
    signal: new AbortController().signal,
    callbacks: {
      onText: (delta: string) => {
        text.push(delta)
      },
      onTool: (tool: ToolActivity) => {
        tools.push(tool)
      },
    },
    fetcher: async (input: string, init: RequestInit) => {
      requests.push({ input, init })
      return response
    },
  }
}

type ChatFixture = ReturnType<typeof givenChatResponse>
type ChatOutcome = Awaited<ReturnType<typeof requestChat>>

function whenChatRequested(chat: ChatFixture): Promise<ChatOutcome> {
  return requestChat('List events', chat.signal, chat.callbacks, chat.fetcher)
}

function thenChatSucceeded(outcome: ChatOutcome) {
  expect(outcome._tag).toBe('Success')
}

function thenChatFailed(outcome: ChatOutcome, message?: string) {
  expect(outcome._tag).toBe('Failure')
  if (outcome._tag === 'Failure') {
    expect(outcome.error).toBeInstanceOf(Error)
    if (message) {
      expect(outcome.error.message).toContain(message)
    }
  }
}

function givenInMemoryApp() {
  const services = createServices(
    new InMemoryEventRepository({ users: new Set(), venues: new Set() }),
  )
  return createApp(services, { mcpUrl: () => 'http://127.0.0.1:3000/mcp' })
}

async function whenUiRequested(app: ReturnType<typeof givenInMemoryApp>) {
  const [page, js, css, missing, repeatedJs] = await Promise.all([
    app.request('/'),
    app.request('/chat-ui.js'),
    app.request('/chat-ui.css'),
    app.request('/not-a-route'),
    app.request('/chat-ui.js'),
  ])
  return {
    page,
    js,
    css,
    missing,
    html: await page.text(),
    script: await js.text(),
    styles: await css.text(),
    repeatedScript: await repeatedJs.text(),
  }
}

function thenUiUsesSafeLocalAssets(
  ui: Awaited<ReturnType<typeof whenUiRequested>>,
) {
  expect(ui.page.status).toBe(200)
  expect(ui.page.headers.get('Content-Type')).toContain('text/html')
  expect(ui.page.headers.get('Content-Security-Policy')).toContain(
    "connect-src 'self'",
  )
  expect(ui.html).toContain('Chatting as Alice')
  expect(ui.html).toContain('No chat history is sent')
  expect(ui.html).toContain('role="status"')
  expect(ui.html).toContain('role="alert"')
  expect(ui.html).toContain('maxlength="4000"')
  expect(ui.html).toContain('src="/chat-ui.js"')
  expect(ui.html).toContain('href="/chat-ui.css"')
  expect(ui.js.status).toBe(200)
  expect(ui.js.headers.get('Content-Type')).toContain('javascript')
  expect(ui.script).toContain(aliceUserId)
  expect(ui.script).not.toContain('OPENROUTER_API_KEY')
  expect(ui.script).not.toContain('openrouter.ai/api')
  expect(ui.script).not.toContain('innerHTML')
  expect(ui.css.status).toBe(200)
  expect(ui.css.headers.get('Content-Type')).toContain('text/css')
  expect(ui.styles).toContain('@media (max-width: 760px)')
  expect(ui.missing.status).toBe(404)
  expect(ui.repeatedScript).toBe(ui.script)
}

function thenOnlyCurrentMessageIsSentAsAlice(chat: ChatFixture) {
  expect(chat.text.join('')).toBe('Hello café <img src=x onerror=alert(1)>')
  expect(chat.requests).toHaveLength(1)
  expect(chat.requests[0].input).toBe('/chat')
  const init = chat.requests[0].init
  expect(init.method).toBe('POST')
  expect(init.headers).toEqual({
    'Content-Type': 'application/json',
    'X-User-Id': aliceUserId,
    Accept: 'text/event-stream',
  })
  expect(JSON.parse(init.body as string)).toEqual({ message: 'List events' })
  expect(init.signal).toBeInstanceOf(AbortSignal)
}

function thenToolPhasesAreReported(chat: ChatFixture) {
  expect(chat.tools).toEqual([
    { id: 't1', name: 'list_events', phase: 'started' },
    { id: 't1', phase: 'arguments', detail: '{}' },
    { id: 't1', phase: 'running' },
    { id: 't1', phase: 'result', detail: '<b>not HTML</b>' },
  ])
  expect(chat.text).toEqual(['Found events.'])
}

function thenPartialTextIsPreserved(chat: ChatFixture) {
  expect(chat.text).toEqual(['Partial answer'])
}

function givenFinishedStreamWithoutEof() {
  let cancelled = false
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encode(finished))
      },
      cancel() {
        cancelled = true
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
  return { chat: givenChatResponse(response), wasCancelled: () => cancelled }
}

function thenReaderWasCancelled(
  stream: ReturnType<typeof givenFinishedStreamWithoutEof>,
) {
  expect(stream.wasCancelled()).toBe(true)
}

function givenAlreadyStoppedChat() {
  const controller = new AbortController()
  controller.abort()
  const chat = givenChatResponse(givenStreamResponse([]))
  chat.signal = controller.signal
  chat.fetcher = async (_input, init) => {
    init.signal?.throwIfAborted()
    return givenStreamResponse([])
  }
  return chat
}

function givenChatStoppedDuringStreaming() {
  const controller = new AbortController()
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(
          encode(event({ type: 'TEXT_MESSAGE_CONTENT', delta: 'Starting' })),
        )
        controller.signal.addEventListener('abort', () =>
          stream.error(new DOMException('Aborted', 'AbortError')),
        )
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
  const chat = givenChatResponse(response)
  chat.signal = controller.signal
  chat.callbacks.onText = () => controller.abort()
  return chat
}

function thenChatIsStopped(chat: ChatFixture, outcome: ChatOutcome) {
  thenChatFailed(outcome)
  expect(chat.signal.aborted).toBe(true)
}

test('chat UI is wired at GET / with local assets and no backend configuration in the bundle', async () => {
  const app = givenInMemoryApp()
  const ui = await whenUiRequested(app)
  thenUiUsesSafeLocalAssets(ui)
})

test('chat client sends only one message with Alice identity and parses split UTF-8, CRLF and multiline SSE', async () => {
  const raw = encode(
    ': heartbeat\r\n\r\nevent: message\r\ndata: {"type":"TEXT_MESSAGE_CONTENT",\r\ndata: "delta":"Hello café <img src=x onerror=alert(1)>"}\r\n\r\n' +
      finished,
  )
  const chat = givenChatResponse(
    givenStreamResponse(Array.from(raw, (byte) => Uint8Array.of(byte))),
  )
  const outcome = await whenChatRequested(chat)
  thenChatSucceeded(outcome)
  thenOnlyCurrentMessageIsSentAsAlice(chat)
})

test('chat client reports tool start, argument deltas, execution and result separately', async () => {
  const chat = givenChatResponse(
    givenStreamResponse([
      encode(
        [
          { type: 'RUN_STARTED' },
          {
            type: 'TOOL_CALL_START',
            toolCallId: 't1',
            toolCallName: 'list_events',
          },
          { type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta: '{}' },
          { type: 'TOOL_CALL_END', toolCallId: 't1' },
          {
            type: 'RUN_FINISHED',
            metadata: { tanstack: { finishReason: 'tool_calls' } },
          },
          {
            type: 'TOOL_CALL_RESULT',
            toolCallId: 't1',
            content: '<b>not HTML</b>',
          },
          { type: 'TEXT_MESSAGE_CONTENT', delta: 'Found events.' },
          { type: 'RUN_FINISHED' },
        ]
          .map(event)
          .join(''),
      ),
    ]),
  )
  const outcome = await whenChatRequested(chat)
  thenChatSucceeded(outcome)
  thenToolPhasesAreReported(chat)
})

test('chat client surfaces pre-stream JSON and non-JSON HTTP errors', async () => {
  for (const [response, expected] of [
    [
      Response.json(
        { error: { message: 'Set OPENROUTER_API_KEY to enable chat.' } },
        { status: 503 },
      ),
      'Set OPENROUTER_API_KEY to enable chat.',
    ],
    [
      Response.json({ error: { message: 'Unknown user' } }, { status: 401 }),
      'Unknown user',
    ],
    [new Response('<h1>Bad gateway</h1>', { status: 502 }), 'HTTP 502'],
    [new Response('not SSE'), 'did not return a chat stream'],
  ] as const) {
    const chat = givenChatResponse(response)
    const outcome = await whenChatRequested(chat)
    thenChatFailed(outcome, expected)
  }
})

test('chat client preserves partial text and reports RUN_ERROR, malformed events and truncated streams', async () => {
  const chat = givenChatResponse(
    givenStreamResponse([
      encode(
        event({ type: 'TEXT_MESSAGE_CONTENT', delta: 'Partial answer' }) +
          event({
            type: 'RUN_ERROR',
            message: 'The AI run failed. Please retry.',
          }),
      ),
    ]),
  )
  const outcome = await whenChatRequested(chat)
  thenChatFailed(outcome, 'The AI run failed')
  thenPartialTextIsPreserved(chat)

  for (const [data, expected] of [
    ['data: not-json\n\n', 'unreadable chat event'],
    ['data: null\n\n', 'invalid chat event'],
    ['', 'ended before completion'],
    [
      event({ type: 'TEXT_MESSAGE_CONTENT', delta: 'Partial' }),
      'ended before completion',
    ],
    ['data: [DONE]\n\n', 'ended before completion'],
    ['data: {"type":"RUN_FINISHED"}', 'ended before completion'],
  ]) {
    const invalidChat = givenChatResponse(givenStreamResponse([encode(data)]))
    const invalidOutcome = await whenChatRequested(invalidChat)
    thenChatFailed(invalidOutcome, expected)
  }
})

test('chat client cancels the reader on terminal completion without waiting for EOF', async () => {
  const stream = givenFinishedStreamWithoutEof()
  const outcome = await whenChatRequested(stream.chat)
  thenChatSucceeded(outcome)
  thenReaderWasCancelled(stream)
})

test.each([
  { type: 'TEXT_MESSAGE_CONTENT', delta: 42 },
  { type: 'TOOL_CALL_START' },
  { type: 'TOOL_CALL_ARGS', toolCallId: 't1' },
  { type: 'TOOL_CALL_END', toolCallId: 42 },
  { type: 'TOOL_CALL_RESULT', toolCallId: 't1' },
  { type: 'RUN_ERROR', message: 42 },
])('chat client rejects malformed known events: %j', async (invalid) => {
  const chat = givenChatResponse(
    givenStreamResponse([encode(event(invalid) + finished)]),
  )
  const outcome = await whenChatRequested(chat)
  thenChatFailed(outcome, 'invalid chat event')
  expect(chat.text).toEqual([])
  expect(chat.tools).toEqual([])
})

test('chat client ignores unknown events and ignores events after terminal completion', async () => {
  const chat = givenChatResponse(
    givenStreamResponse([
      encode(
        event({ type: 'FUTURE_EVENT', extra: true }) +
          event({ type: 'TEXT_MESSAGE_CONTENT', delta: 'Complete' }) +
          finished +
          event({ type: 'RUN_ERROR', message: 'Too late' }) +
          event({ type: 'TEXT_MESSAGE_CONTENT', delta: 'Too late' }),
      ),
    ]),
  )
  const outcome = await whenChatRequested(chat)
  thenChatSucceeded(outcome)
  expect(chat.text).toEqual(['Complete'])
})

test('chat client fails completion when a tool has no reported result', async () => {
  const chat = givenChatResponse(
    givenStreamResponse([
      encode(event({ type: 'TOOL_CALL_START', toolCallId: 't1' }) + finished),
    ]),
  )
  const outcome = await whenChatRequested(chat)
  thenChatFailed(outcome, 'No action is confirmed')
  expect(chat.tools).toEqual([{ id: 't1', phase: 'started', name: 'Tool' }])
})

test.each([
  { content: null },
  { content: { success: true } },
  { content: ['a', 'b'] },
])(
  'chat client serializes structured tool results: %j',
  async ({ content }) => {
    const chat = givenChatResponse(
      givenStreamResponse([
        encode(
          event({ type: 'TOOL_CALL_RESULT', toolCallId: 't1', content }) +
            finished,
        ),
      ]),
    )
    const outcome = await whenChatRequested(chat)
    thenChatSucceeded(outcome)
    expect(chat.tools).toEqual([
      { id: 't1', phase: 'result', detail: JSON.stringify(content) },
    ])
  },
)

test('chat client returns network failures as values', async () => {
  const chat = givenChatResponse(givenStreamResponse([]))
  chat.fetcher = () => Promise.reject(new Error('Network unavailable'))
  const outcome = await whenChatRequested(chat)
  thenChatFailed(outcome, 'Network unavailable')
})

test('chat client releases its reader when a rendering callback fails', async () => {
  const response = givenStreamResponse([
    encode(event({ type: 'TEXT_MESSAGE_CONTENT', delta: 'Hello' })),
  ])
  const chat = givenChatResponse(response)
  chat.callbacks.onText = () => {
    throw new Error('Rendering failed')
  }
  const outcome = await whenChatRequested(chat)
  thenChatFailed(outcome, 'Rendering failed')
  expect(response.body?.locked).toBe(false)
})

test('chat client propagates stop aborts before fetch and during streaming', async () => {
  for (const chat of [
    givenAlreadyStoppedChat(),
    givenChatStoppedDuringStreaming(),
  ]) {
    const outcome = await whenChatRequested(chat)
    thenChatIsStopped(chat, outcome)
  }
})
