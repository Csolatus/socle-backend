import * as v from 'valibot'
import { Result } from '#/shared-kernel/result.ts'

export type ToolActivity =
  | { id: string; phase: 'started'; name: string }
  | { id: string; phase: 'arguments'; detail: string }
  | { id: string; phase: 'running' }
  | { id: string; phase: 'result'; detail: string }

const eventEnvelopeSchema = v.object({ type: v.string() })
const chatEventSchema = v.variant('type', [
  v.object({ type: v.literal('TEXT_MESSAGE_CONTENT'), delta: v.string() }),
  v.object({
    type: v.literal('TOOL_CALL_START'),
    toolCallId: v.string(),
    toolCallName: v.optional(v.string(), 'Tool'),
  }),
  v.object({
    type: v.literal('TOOL_CALL_ARGS'),
    toolCallId: v.string(),
    delta: v.string(),
  }),
  v.object({ type: v.literal('TOOL_CALL_END'), toolCallId: v.string() }),
  v.object({
    type: v.literal('TOOL_CALL_RESULT'),
    toolCallId: v.string(),
    content: v.pipe(
      v.unknown(),
      v.check((value) => value !== undefined),
    ),
  }),
  v.object({
    type: v.literal('RUN_ERROR'),
    message: v.optional(v.string(), 'The AI run failed. Please retry.'),
  }),
  v.object({
    type: v.literal('RUN_FINISHED'),
    metadata: v.optional(v.unknown()),
  }),
])
type ChatEvent = v.InferOutput<typeof chatEventSchema> | { type: 'IGNORED' }

const toolIterationSchema = v.object({
  tanstack: v.object({ finishReason: v.literal('tool_calls') }),
})

export function isToolIteration(metadata: unknown): boolean {
  return v.safeParse(toolIterationSchema, metadata).success
}

// JSON.parse is confined to this adapter; its output is validated before use.
export function decodeChatEvent(data: string): Result<ChatEvent, Error> {
  let input: unknown
  try {
    input = JSON.parse(data)
  } catch {
    return Result.fail(
      new Error('The server sent an unreadable chat event. Please try again.'),
    )
  }
  const envelope = v.safeParse(eventEnvelopeSchema, input)
  if (!envelope.success) {
    return invalidEvent()
  }
  switch (envelope.output.type) {
    case 'TEXT_MESSAGE_CONTENT':
    case 'TOOL_CALL_START':
    case 'TOOL_CALL_ARGS':
    case 'TOOL_CALL_END':
    case 'TOOL_CALL_RESULT':
    case 'RUN_ERROR':
    case 'RUN_FINISHED': {
      const event = v.safeParse(chatEventSchema, input)
      return event.success ? Result.succeed(event.output) : invalidEvent()
    }
    default:
      // Lifecycle events we do not render, and future protocol extensions.
      return Result.succeed({ type: 'IGNORED' })
  }
}

function invalidEvent(): Result<never, Error> {
  return Result.fail(
    new Error('The server sent an invalid chat event. Please try again.'),
  )
}
