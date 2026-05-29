export interface ToolResult {
  ok: boolean
  summary: string
  data?: Record<string, unknown>
}

export interface VideoEditorTool {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  uiDescription: (args: Record<string, unknown>) => string
  handler: (args: Record<string, unknown>) => Promise<ToolResult>
}

// Tool registry — populated by each handler module
const registry = new Map<string, VideoEditorTool>()

export function registerTool(tool: VideoEditorTool): void {
  registry.set(tool.name, tool)
}

export function getTool(name: string): VideoEditorTool | undefined {
  return registry.get(name)
}

export function getAllTools(): VideoEditorTool[] {
  return Array.from(registry.values())
}

export function getFunctionDeclarations() {
  return getAllTools().map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }))
}
