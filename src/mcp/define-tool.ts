import * as v from 'valibot'
import { z } from 'zod'
import { toJsonSchema } from '@valibot/to-json-schema'
import {
  ErrorCode,
  McpError,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import type { ApplicationError } from '#/application/ports.ts'
import { Result } from '#/shared-kernel/result.ts'

export interface McpTool {
  definition: Pick<Tool, 'name' | 'description' | 'annotations'>
  registration: { inputSchema: z.ZodType; outputSchema: z.ZodType }
  call: (
    input: unknown,
  ) => Promise<Result<Record<string, unknown>, ApplicationError | McpError>>
}
type ObjectSchema = v.GenericSchema<
  Record<string, unknown>,
  Record<string, unknown>
>

interface ToolOptions<
  Input extends v.GenericSchema,
  Output extends ObjectSchema,
> {
  name: string
  description: string
  input: Input
  output: Output
  readOnly: boolean
  execute: (
    input: v.InferOutput<Input>,
  ) => Promise<Result<v.InferInput<Output>, ApplicationError>>
}

export function defineTool<
  Input extends v.GenericSchema,
  Output extends ObjectSchema,
>(options: ToolOptions<Input, Output>): McpTool {
  const { input, output } = options
  const inputJson = toJsonSchema(input, {
    typeMode: 'input',
    ignoreActions: ['check', 'trim'],
  })
  const outputJson = toJsonSchema(output, {
    typeMode: 'output',
    ignoreActions: ['check', 'trim'],
  })
  return {
    // Both libraries implement JSON Schema, but their schema-document types differ.
    // Adapt only this generated wire document, never a tool argument or domain value.
    registration: {
      inputSchema: z.fromJSONSchema(inputJson as z.core.JSONSchema.JSONSchema),
      outputSchema: z.fromJSONSchema(
        outputJson as z.core.JSONSchema.JSONSchema,
      ),
    },
    definition: {
      name: options.name,
      description: options.description,
      annotations: {
        readOnlyHint: options.readOnly,
        destructiveHint: !options.readOnly,
        openWorldHint: false,
      },
    },
    call: async (arguments_) => {
      const parsed = v.safeParse(input, arguments_)
      if (!parsed.success) {
        return Result.fail(
          new McpError(
            ErrorCode.InvalidParams,
            parsed.issues.map((issue) => issue.message).join('; '),
          ),
        )
      }
      const result = await options.execute(parsed.output)
      // Output validation failures indicate broken server state, never invalid requests.
      return Result.map(result, (value): Record<string, unknown> =>
        v.parse(output, value),
      )
    },
  }
}
