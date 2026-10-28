import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'
import type { AnyTextAdapter } from '@tanstack/ai'
import { Result } from '#/shared-kernel/result.ts'

export function openRouterAdapter(): Result<
  AnyTextAdapter,
  'AI_NOT_CONFIGURED'
> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return Result.fail('AI_NOT_CONFIGURED')
  }
  return Result.succeed(
    openaiCompatibleText(process.env.OPENROUTER_MODEL ?? 'z-ai/glm-5.3-flash', {
      name: 'openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
      api: 'chat-completions',
    }),
  )
}
