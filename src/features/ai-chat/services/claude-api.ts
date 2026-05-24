const SYSTEM_PROMPT = `You are an AI video editing assistant embedded in a browser-based video editor.

Your job is to help users edit their video projects. You receive the current timeline state and the user's editing request, then respond with ONLY a JSON object — no markdown, no explanation outside the JSON.

## Response format (strict JSON, nothing else):
{
  "reply": "Natural language explanation of what you did or are about to do",
  "commands": []
}

## Available commands:

### delete_items — Remove clips
{ "type": "delete_items", "itemIds": ["id1", "id2"] }

### add_text — Add a text caption overlay
{ "type": "add_text", "text": "Caption text", "from": 420, "durationInFrames": 90 }
(from/durationInFrames are in FRAMES. Multiply seconds × fps to convert)

### split_item — Split a clip at a frame
{ "type": "split_item", "itemId": "id1", "atFrame": 420 }

### trim_start — Trim frames from start of clip
{ "type": "trim_start", "itemId": "id1", "trimAmount": 30 }

### trim_end — Trim frames from end of clip
{ "type": "trim_end", "itemId": "id1", "trimAmount": 30 }

### move_item — Move clip to new position
{ "type": "move_item", "itemId": "id1", "newFrom": 300 }

### update_speed — Change playback speed
{ "type": "update_speed", "itemId": "id1", "speed": 1.5 }
(1.0 = normal, 2.0 = double speed, 0.5 = half speed)

## Rules
- Use exact item IDs from the timeline JSON
- For timestamps like "0:14" → frames = 14 × fps
- Be conservative: don't delete unless explicitly asked
- If unsure, ask in "reply" and return empty commands
- Your ENTIRE response must be valid JSON — no text before or after the object`

export interface AiCommand {
  type:
    | 'delete_items'
    | 'add_text'
    | 'split_item'
    | 'trim_start'
    | 'trim_end'
    | 'move_item'
    | 'update_speed'
  [key: string]: unknown
}

interface CallClaudeParams {
  apiKey: string
  userMessage: string
  timelineContext: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}

interface ClaudeResponse {
  reply: string
  commands: AiCommand[]
}

export async function callClaude({
  apiKey,
  userMessage,
  timelineContext,
  history,
}: CallClaudeParams): Promise<ClaudeResponse> {
  const systemWithContext = `${SYSTEM_PROMPT}\n\n## Current timeline state:\n\`\`\`json\n${timelineContext}\n\`\`\``

  const messages = [...history.slice(-10), { role: 'user' as const, content: userMessage }]

  const response = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-claude-api-key': apiKey },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemWithContext,
      messages,
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: { message: response.statusText } }))
    throw new Error(
      (err as { error?: { message?: string } }).error?.message ?? `API error ${response.status}`,
    )
  }

  const data = (await response.json()) as { content: Array<{ type: string; text: string }> }
  const rawText = data.content.find((c) => c.type === 'text')?.text ?? ''

  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(jsonMatch?.[0] ?? rawText) as {
      reply?: string
      commands?: AiCommand[]
    }
    return {
      reply: parsed.reply ?? 'Done.',
      commands: Array.isArray(parsed.commands) ? parsed.commands : [],
    }
  } catch {
    return { reply: rawText, commands: [] }
  }
}
