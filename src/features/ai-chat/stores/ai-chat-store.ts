import { create } from 'zustand'
import { runAgentLoop } from '../services/agent-loop'
import { serializeTimeline } from '../services/timeline-context'
import { extractSegmentFrames } from '../services/video-analyzer'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import {
  captureSnapshot,
  restoreSnapshot,
  type TimelineSnapshot,
} from '@/features/editor/deps/timeline-store'
import type { AgentEvent } from '../services/agent-events'

function parseSegmentFrames(
  text: string,
  fps: number,
): { startFrame: number; endFrame: number } | null {
  const m = text.match(/^\[Segment (\d+):(\d+(?:\.\d+)?) [→>-]+ (\d+):(\d+(?:\.\d+)?)\]/)
  if (!m) return null
  const toFrames = (min: string, sec: string) =>
    Math.round((parseInt(min) * 60 + parseFloat(sec)) * fps)
  return {
    startFrame: toFrames(m[1]!, m[2]!),
    endFrame: toFrames(m[3]!, m[4]!),
  }
}

export interface ToolStep {
  id: string
  tool: string
  description: string
  status: 'running' | 'done' | 'error'
  summary?: string
  error?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  commandCount?: number
  hasCheckpoint?: boolean
  toolSteps?: ToolStep[]
  pendingClarification?: { question: string; options?: string[] }
}

interface FocusState {
  lastTouchedItemIds: string[]
  lastTouchedTrackId: string | null
}

interface AiChatState {
  messages: ChatMessage[]
  isLoading: boolean
  error: string | null
  checkpoints: Record<string, TimelineSnapshot>
  focusState: FocusState
  sendMessage: (text: string) => Promise<void>
  clearMessages: () => void
  restoreCheckpoint: (messageId: string) => void
}

export const useAiChatStore = create<AiChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  error: null,
  checkpoints: {},
  focusState: { lastTouchedItemIds: [], lastTouchedTrackId: null },

  clearMessages: () =>
    set({
      messages: [],
      error: null,
      checkpoints: {},
      focusState: { lastTouchedItemIds: [], lastTouchedTrackId: null },
    }),

  restoreCheckpoint: (messageId) => {
    const snapshot = get().checkpoints[messageId]
    if (!snapshot) return
    restoreSnapshot(snapshot)
  },

  sendMessage: async (text) => {
    const { messages, focusState } = get()

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }

    // Track the in-progress assistant message ID so we can update it as tool steps arrive
    const assistantId = crypto.randomUUID()
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolSteps: [],
    }

    set({
      messages: [...messages, userMessage, assistantMessage],
      isLoading: true,
      error: null,
    })

    try {
      const timelineContext = serializeTimeline()

      // Build conversation history (exclude the empty in-progress assistant message)
      const history = [...messages].map((m) => ({ role: m.role, content: m.content }))

      // Inject focus context as a system hint at the end of user message
      let enrichedText = text
      if (focusState.lastTouchedItemIds.length > 0) {
        const { items } = useTimelineStore.getState()
        const focusedLabels = focusState.lastTouchedItemIds
          .map((id) => items.find((i) => i.id === id)?.label)
          .filter(Boolean)
          .slice(0, 3)
        if (focusedLabels.length > 0) {
          enrichedText = `${text}\n\n[Context: Last edited: ${focusedLabels.join(', ')}]`
        }
      }

      const fps = useTimelineStore.getState().fps

      // Auto-extract video frames for segment requests
      let videoFrames: Array<{ data: string; timestampSec: number }> | undefined
      const segRange = parseSegmentFrames(text, fps)
      if (segRange) {
        try {
          const frameSets = await extractSegmentFrames(
            segRange.startFrame,
            segRange.endFrame,
            fps,
            5,
          )
          if (frameSets.length > 0) {
            videoFrames = frameSets.flatMap((fs) =>
              fs.frames.map((data, i) => ({
                data,
                timestampSec:
                  fs.startSec + (i / Math.max(1, fs.frames.length - 1)) * (fs.endSec - fs.startSec),
              })),
            )
          }
        } catch {
          // best-effort
        }
      }

      const snapshot = captureSnapshot()

      // Live tool step accumulator
      const toolSteps: ToolStep[] = []

      const onEvent = (event: AgentEvent) => {
        switch (event.type) {
          case 'tool_start': {
            const step: ToolStep = {
              id: crypto.randomUUID(),
              tool: event.tool,
              description: event.description,
              status: 'running',
            }
            toolSteps.push(step)
            set((s) => ({
              messages: s.messages.map((m) =>
                m.id === assistantId ? { ...m, toolSteps: [...toolSteps] } : m,
              ),
            }))
            break
          }
          case 'tool_done':
          case 'tool_error': {
            const step = toolSteps.find((s) => s.tool === event.tool && s.status === 'running')
            if (step) {
              step.status = event.type === 'tool_done' ? 'done' : 'error'
              if (event.type === 'tool_done') step.summary = event.summary
              if (event.type === 'tool_error') step.error = event.error
            }
            set((s) => ({
              messages: s.messages.map((m) =>
                m.id === assistantId ? { ...m, toolSteps: [...toolSteps] } : m,
              ),
            }))
            break
          }
          default:
            break
        }
      }

      const { reply, toolCallCount } = await runAgentLoop({
        userMessage: enrichedText,
        timelineContext,
        history,
        videoFrames,
        onEvent,
      })

      const touchedIds: string[] = []

      const finalMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: reply,
        timestamp: Date.now(),
        commandCount: toolCallCount,
        hasCheckpoint: toolCallCount > 0,
        toolSteps: [...toolSteps],
      }

      set((s) => ({
        messages: s.messages.map((m) => (m.id === assistantId ? finalMessage : m)),
        isLoading: false,
        checkpoints:
          toolCallCount > 0 ? { ...s.checkpoints, [assistantId]: snapshot } : s.checkpoints,
        focusState:
          touchedIds.length > 0
            ? { lastTouchedItemIds: touchedIds, lastTouchedTrackId: null }
            : s.focusState,
      }))
    } catch (err) {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantId ? { ...m, content: 'Something went wrong. Please try again.' } : m,
        ),
        error: err instanceof Error ? err.message : 'Something went wrong.',
        isLoading: false,
      }))
    }
  },
}))
