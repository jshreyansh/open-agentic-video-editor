import '../tools/init-tools'
import { getFunctionDeclarations, getTool } from '../tools/tool-registry'
import { createLogger } from '@/shared/logging/logger'
import type { AgentEventCallback } from './agent-events'

const log = createLogger('ai-chat:agent-loop')

const SYSTEM_PROMPT = `You are an expert AI video editing assistant embedded in a browser-based multi-track video editor. You operate EXCLUSIVELY by calling tools — you never describe what you plan to do, you just do it.

## CRITICAL: Always call tools — never respond in plain text for edit tasks

You MUST call a tool for every user request that involves editing, adding, or modifying the timeline. Do NOT:
- Echo back the user's script or instructions
- Describe what you are about to do
- Summarize the user's request without calling tools

## Script with timestamps → add_captions_from_script

When the user provides ANY of the following, call add_captions_from_script IMMEDIATELY with all scenes:
- A scene breakdown with timestamps (e.g. "Scene 1: 00:00 — 00:26")
- A narration script with MM:SS timestamps
- A walkthrough script mapping scenes to time ranges
- Any text containing multiple "00:00" style timestamps

Parse ALL scenes from the message. Extract only the narration/voiceover text as caption content — skip "Business Impact", "Visuals", "Problem" labels. Call the tool ONCE with all scenes in the array.

## How to work for other edits
1. Call get_timeline_state or find_items FIRST when you need item IDs
2. Use returned IDs when calling editing tools — never guess IDs
3. Chain multiple tool calls across up to 8 iterations for complex tasks
4. When genuinely unsure which clip, call ask_user

## Timestamps / frames
- Timeline positions are in FRAMES. fps is in the timeline state.
- To convert: frames = seconds × fps
- Segment prefix [Segment MM:SS → MM:SS] means operate only on that time range

## Rules
- Use exact item IDs from tool results
- Be conservative with deletions — confirm with ask_user if unsure
- add_voiceover auto-creates captions — never add_text for the same voiceover text`

type GeminiRole = 'user' | 'model'
type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } }

interface GeminiContent {
  role: GeminiRole
  parts: GeminiPart[]
}

interface GeminiFunctionCall {
  name: string
  args: Record<string, unknown>
}

interface GeminiApiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
        functionCall?: GeminiFunctionCall
      }>
      role?: string
    }
    finishReason?: string
  }>
  error?: { message?: string; code?: number }
}

export class ClarificationSignal {
  constructor(
    public question: string,
    public options?: string[],
  ) {}
}

async function callGeminiWithTools(
  contents: GeminiContent[],
  timelineContext: string,
  forceTools = false,
): Promise<GeminiApiResponse> {
  const systemWithContext = `${SYSTEM_PROMPT}\n\n## Current timeline state:\n\`\`\`json\n${timelineContext}\n\`\`\``

  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: systemWithContext }] },
      tools: [{ functionDeclarations: getFunctionDeclarations() }],
      // First iteration: ANY forces at least one tool call.
      // Subsequent iterations: AUTO lets Gemini decide when it's done.
      toolConfig: { functionCallingConfig: { mode: forceTools ? 'ANY' : 'AUTO' } },
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.2,
      },
    }),
  })

  return response.json() as Promise<GeminiApiResponse>
}

export interface AgentLoopParams {
  userMessage: string
  timelineContext: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  videoFrames?: Array<{ data: string; timestampSec: number }>
  onEvent: AgentEventCallback
}

export interface AgentLoopResult {
  reply: string
  toolCallCount: number
}

export async function runAgentLoop(params: AgentLoopParams): Promise<AgentLoopResult> {
  const { userMessage, timelineContext, history, videoFrames, onEvent } = params

  // Build initial message list from history
  const contents: GeminiContent[] = history.slice(-12).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  // Add the current user message (with optional video frames)
  const userParts: GeminiPart[] = []
  if (videoFrames && videoFrames.length > 0) {
    userParts.push({
      text: `[${videoFrames.length} video frames — timestamps: ${videoFrames.map((f) => `${f.timestampSec.toFixed(1)}s`).join(', ')}]`,
    })
    for (const frame of videoFrames) {
      userParts.push({ inlineData: { mimeType: 'image/jpeg', data: frame.data } })
    }
  }
  userParts.push({ text: userMessage })
  contents.push({ role: 'user', parts: userParts })

  const MAX_ITERATIONS = 8
  let totalToolCalls = 0
  let finalReply = ''

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    onEvent({ type: 'thinking', iteration })

    // Force at least one tool call on the first iteration so Gemini doesn't
    // respond in plain text when the user gives a script or edit request.
    const data = await callGeminiWithTools(contents, timelineContext, iteration === 0)

    if (data.error) {
      throw new Error(data.error.message ?? 'Gemini API error')
    }

    const candidate = data.candidates?.[0]
    if (!candidate?.content?.parts) break

    const parts = candidate.content.parts
    const textParts = parts.filter((p) => p.text !== undefined)
    const funcCallParts = parts.filter((p) => p.functionCall !== undefined)

    // Accumulate any text
    const iterText = textParts.map((p) => p.text ?? '').join('')

    // Append model response to contents (required for multi-turn)
    contents.push({ role: 'model', parts: parts as GeminiPart[] })

    // No tool calls → we're done
    if (funcCallParts.length === 0) {
      finalReply = iterText || 'Done.'
      onEvent({ type: 'reply', text: finalReply, toolCallCount: totalToolCalls })
      break
    }

    // Check for ask_user first — it terminates the loop
    const askUserCall = funcCallParts.find((p) => p.functionCall?.name === 'ask_user')
    if (askUserCall?.functionCall) {
      const args = askUserCall.functionCall.args
      const question = (args['question'] as string | undefined) ?? (iterText || 'Can you clarify?')
      const options = args['options'] as string[] | undefined
      finalReply = question
      onEvent({ type: 'clarification', question, options })
      onEvent({ type: 'reply', text: question, toolCallCount: totalToolCalls })
      break
    }

    // Execute all tool calls, collect results for next iteration
    const toolResultParts: GeminiPart[] = []

    for (const part of funcCallParts) {
      const fc = part.functionCall!
      const tool = getTool(fc.name)
      totalToolCalls++

      if (!tool) {
        log.warn('Unknown tool called:', fc.name)
        toolResultParts.push({
          functionResponse: {
            name: fc.name,
            response: { error: `Unknown tool: ${fc.name}` },
          },
        })
        onEvent({ type: 'tool_error', tool: fc.name, error: `Unknown tool: ${fc.name}` })
        continue
      }

      const description = tool.uiDescription(fc.args)
      onEvent({ type: 'tool_start', tool: fc.name, description })

      try {
        const result = await tool.handler(fc.args)
        log.debug(`Tool ${fc.name} →`, result.summary)
        toolResultParts.push({
          functionResponse: {
            name: fc.name,
            response: { ok: result.ok, summary: result.summary, ...(result.data ?? {}) },
          },
        })
        onEvent({ type: 'tool_done', tool: fc.name, summary: result.summary, ok: result.ok })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        log.warn(`Tool ${fc.name} error:`, errMsg)
        toolResultParts.push({
          functionResponse: {
            name: fc.name,
            response: { ok: false, error: errMsg },
          },
        })
        onEvent({ type: 'tool_error', tool: fc.name, error: errMsg })
      }
    }

    // Feed tool results back as a user turn
    contents.push({ role: 'user', parts: toolResultParts })

    // If finish reason is STOP after tool calls, get the final reply in next iteration
    if (candidate.finishReason === 'STOP' && iterText) {
      finalReply = iterText
      onEvent({ type: 'reply', text: finalReply, toolCallCount: totalToolCalls })
      break
    }
  }

  if (!finalReply) {
    finalReply =
      totalToolCalls > 0
        ? `Done. Applied ${totalToolCalls} edit${totalToolCalls !== 1 ? 's' : ''}.`
        : 'I wasn\'t able to process that request. If you\'re adding captions from a script, make sure it includes timestamps in MM:SS format (e.g. "00:00 — 00:26") and narration text for each scene.'
    onEvent({ type: 'reply', text: finalReply, toolCallCount: totalToolCalls })
  }

  onEvent({ type: 'done' })
  return { reply: finalReply, toolCallCount: totalToolCalls }
}
