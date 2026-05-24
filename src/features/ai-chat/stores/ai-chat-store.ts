import { create } from 'zustand'
import { callClaude } from '../services/claude-api'
import { serializeTimeline } from '../services/timeline-context'
import { executeCommands } from '../services/command-executor'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  commandCount?: number
}

interface AiChatState {
  messages: ChatMessage[]
  isLoading: boolean
  error: string | null
  apiKey: string
  sendMessage: (text: string) => Promise<void>
  clearMessages: () => void
  setApiKey: (key: string) => void
}

export const useAiChatStore = create<AiChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  error: null,
  apiKey: localStorage.getItem('claude-api-key') ?? '',

  setApiKey: (key) => {
    localStorage.setItem('claude-api-key', key)
    set({ apiKey: key, error: null })
  },

  clearMessages: () => set({ messages: [], error: null }),

  sendMessage: async (text) => {
    const { messages, apiKey } = get()

    if (!apiKey.trim()) {
      set({ error: 'Add your Anthropic API key above to start chatting.' })
      return
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }

    set({ messages: [...messages, userMessage], isLoading: true, error: null })

    try {
      const timelineContext = serializeTimeline()
      const history = get().messages.map((m) => ({ role: m.role, content: m.content }))

      const { reply, commands } = await callClaude({
        apiKey,
        userMessage: text,
        timelineContext,
        history,
      })

      if (commands.length > 0) {
        executeCommands(commands)
      }

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: reply,
        timestamp: Date.now(),
        commandCount: commands.length,
      }

      set((s) => ({
        messages: [...s.messages, assistantMessage],
        isLoading: false,
      }))
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Something went wrong.',
        isLoading: false,
      })
    }
  },
}))
