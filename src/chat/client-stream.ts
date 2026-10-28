import { createParser } from 'eventsource-parser'
import * as v from 'valibot'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import {
  decodeChatEvent,
  isToolIteration,
  type ToolActivity,
} from './client-events.ts'

export type { ToolActivity } from './client-events.ts'
export const aliceUserId = '01900000-0000-7000-8000-000000000001'

interface ChatCallbacks {
  onText: (delta: string) => void
  onTool: (activity: ToolActivity) => void
}

type FetchChat = (input: string, init: RequestInit) => Promise<Response>

const httpErrorSchema = v.object({
  error: v.object({ message: v.string() }),
})

function requestError(cause: unknown): Error {
  return cause instanceof Error
    ? cause
    : new Error('Unable to connect. Please try again.')
}

async function httpError(response: Response): Promise<Error> {
  const body = await Result.tryPromise(() => response.json(), requestError)
  if (body._tag === 'Success') {
    const error = v.safeParse(httpErrorSchema, body.value)
    if (error.success) {
      return new Error(error.output.error.message)
    }
  }
  // Never render non-JSON error pages as HTML.
  return new Error(
    `Chat request failed (HTTP ${response.status}). Please try again.`,
  )
}

/** Sends one message only; the server does not receive conversation history. */
export async function requestChat(
  message: string,
  signal: AbortSignal,
  callbacks: ChatCallbacks,
  fetcher: FetchChat = fetch,
): Promise<Result<void, Error>> {
  const response = await Result.tryPromise(() => {
    signal.throwIfAborted()
    return fetcher('/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': aliceUserId,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ message }),
      signal,
    })
  }, requestError)
  if (response._tag === 'Failure') {
    return response
  }
  if (!response.value.ok) {
    return Result.fail(await httpError(response.value))
  }
  if (
    !response.value.headers
      .get('Content-Type')
      ?.includes('text/event-stream') ||
    !response.value.body
  ) {
    await response.value.body?.cancel().catch(() => {})
    return Result.fail(
      new Error('The server did not return a chat stream. Please try again.'),
    )
  }
  return readChatStream(response.value.body, signal, callbacks)
}

function createChatParser(callbacks: ChatCallbacks) {
  let outcome = Option.none<Result<void, Error>>()
  const pendingTools = new Set<string>()
  const fail = (message: string) => {
    outcome = Option.some(Result.fail(new Error(message)))
  }
  const parser = createParser({
    maxBufferSize: 1_000_000,
    onError(error) {
      if (Option.isNone(outcome)) {
        fail(`Unable to read the chat stream: ${error.message}`)
      }
    },
    onEvent({ data }) {
      if (Option.isSome(outcome) || data === '[DONE]') {
        return
      }
      const decoded = decodeChatEvent(data)
      if (decoded._tag === 'Failure') {
        outcome = Option.some(decoded)
        return
      }
      const event = decoded.value
      switch (event.type) {
        case 'RUN_ERROR':
          fail(event.message)
          return
        case 'RUN_FINISHED':
          // TanStack reports the provider's per-iteration finish before tools run.
          if (isToolIteration(event.metadata)) {
            return
          }
          if (pendingTools.size > 0) {
            fail(
              'The run ended without reporting its tool results. No action is confirmed. Check events or reservations before retrying a write.',
            )
            return
          }
          outcome = Option.some(Result.succeed(undefined))
          return
        case 'TEXT_MESSAGE_CONTENT':
          callbacks.onText(event.delta)
          return
        case 'TOOL_CALL_START':
          pendingTools.add(event.toolCallId)
          callbacks.onTool({
            id: event.toolCallId,
            phase: 'started',
            name: event.toolCallName,
          })
          return
        case 'TOOL_CALL_ARGS':
          callbacks.onTool({
            id: event.toolCallId,
            phase: 'arguments',
            detail: event.delta,
          })
          return
        case 'TOOL_CALL_END':
          callbacks.onTool({ id: event.toolCallId, phase: 'running' })
          return
        case 'TOOL_CALL_RESULT':
          pendingTools.delete(event.toolCallId)
          callbacks.onTool({
            id: event.toolCallId,
            phase: 'result',
            detail:
              typeof event.content === 'string'
                ? event.content
                : JSON.stringify(event.content),
          })
          return
        case 'IGNORED':
          return
      }
    },
  })
  return { feed: (text: string) => parser.feed(text), outcome: () => outcome }
}

async function readChatStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  callbacks: ChatCallbacks,
): Promise<Result<void, Error>> {
  // Reader and callback exceptions are contained at the browser stream boundary.
  const read = await Result.tryPromise(async () => {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    const parser = createChatParser(callbacks)
    try {
      while (Option.isNone(parser.outcome())) {
        signal.throwIfAborted()
        const { value, done } = await reader.read()
        if (done) {
          parser.feed(decoder.decode())
          break
        }
        parser.feed(decoder.decode(value, { stream: true }))
      }
      signal.throwIfAborted()
      const outcome = parser.outcome()
      if (Option.isSome(outcome)) {
        return outcome.value
      }
      return Result.fail(
        new Error(
          'The stream ended before completion. The response may be incomplete. Please try again.',
        ),
      )
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }, requestError)
  return read._tag === 'Failure' ? read : read.value
}
