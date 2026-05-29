export type AgentEvent =
  | { type: 'thinking'; iteration: number }
  | { type: 'tool_start'; tool: string; description: string }
  | { type: 'tool_done'; tool: string; summary: string; ok: boolean }
  | { type: 'tool_error'; tool: string; error: string }
  | { type: 'clarification'; question: string; options?: string[] }
  | { type: 'reply'; text: string; toolCallCount: number }
  | { type: 'done' }

export type AgentEventCallback = (event: AgentEvent) => void
