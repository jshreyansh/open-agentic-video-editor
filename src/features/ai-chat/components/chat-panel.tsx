import { memo, useEffect, useRef, useState } from 'react'
import {
  Bot,
  Send,
  Trash2,
  X,
  Loader2,
  RotateCcw,
  Clock,
  ChevronRight,
  Mic,
  CheckCircle2,
  AlertCircle,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/shared/ui/cn'
import { useAiChatStore } from '../stores/ai-chat-store'
import { VoiceRecorder } from './voice-recorder'
import type { ChatMessage, ToolStep } from '../stores/ai-chat-store'

function normaliseTime(raw: string): string {
  const parts = raw
    .trim()
    .split(':')
    .map((p) => p.padStart(2, '0'))
  if (parts.length === 2 || parts.length === 3) return parts.join(':')
  return raw
}

export const ChatPanel = memo(function ChatPanel({ onClose }: { onClose?: () => void }) {
  const { messages, isLoading, error, sendMessage, clearMessages, restoreCheckpoint } =
    useAiChatStore()

  const [input, setInput] = useState('')
  const [showDuration, setShowDuration] = useState(false)
  const [durationStart, setDurationStart] = useState('')
  const [durationEnd, setDurationEnd] = useState('')
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, isLoading])

  useEffect(() => {
    if (showDuration) startRef.current?.focus()
  }, [showDuration])

  const hasDuration = durationStart.trim() || durationEnd.trim()

  const clearDuration = () => {
    setDurationStart('')
    setDurationEnd('')
    setShowDuration(false)
  }

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || isLoading) return

    let finalMessage = text
    if (hasDuration && !overrideText) {
      const from = normaliseTime(durationStart) || '00:00'
      const to = normaliseTime(durationEnd) || 'end'
      finalMessage = `[Segment ${from} → ${to}] ${text}`
    }

    setInput('')
    clearDuration()
    await sendMessage(finalMessage)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <div className="flex h-full flex-col border-l border-border bg-background">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">AI Chat</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={clearMessages}
            title="Clear chat"
            disabled={messages.length === 0}
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && !isLoading && (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
            <Bot className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Describe what you want to do with your video.
            </p>
            <div className="space-y-1 text-xs text-muted-foreground/70">
              <p>"Trim the first clip by 2 seconds"</p>
              <p>"Add a zoom at 0:30 for 3 seconds"</p>
              <p>"Generate a voiceover: Welcome to the demo"</p>
              <p>"Add a fade transition between the two clips"</p>
              <p>"Speed up the middle section by 1.5x"</p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onRestore={msg.hasCheckpoint ? () => restoreCheckpoint(msg.id) : undefined}
            onClarificationAnswer={(answer) => void handleSend(answer)}
          />
        ))}

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-border p-3 space-y-2">
        {showVoiceRecorder && <VoiceRecorder onClose={() => setShowVoiceRecorder(false)} />}

        {hasDuration && !showDuration && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/10 border border-primary/20 w-fit">
            <Clock className="h-3 w-3 text-primary shrink-0" />
            <span className="text-xs text-primary font-mono">
              {normaliseTime(durationStart) || '00:00'}
              <ChevronRight className="inline h-3 w-3 mx-0.5 opacity-60" />
              {normaliseTime(durationEnd) || 'end'}
            </span>
            <button
              className="ml-0.5 text-primary/60 hover:text-primary transition-colors"
              onClick={() => setShowDuration(true)}
            >
              <Clock className="h-3 w-3" />
            </button>
            <button
              className="text-primary/60 hover:text-primary transition-colors"
              onClick={clearDuration}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {showDuration && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-secondary/40 border border-border">
            <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <div className="flex items-center gap-1 flex-1">
              <input
                ref={startRef}
                type="text"
                placeholder="00:00"
                value={durationStart}
                onChange={(e) => setDurationStart(e.target.value)}
                className="w-16 bg-background border border-border rounded px-1.5 py-0.5 text-xs font-mono text-center focus:outline-none focus:ring-1 focus:ring-primary"
                maxLength={8}
              />
              <span className="text-xs text-muted-foreground">→</span>
              <input
                type="text"
                placeholder="00:00"
                value={durationEnd}
                onChange={(e) => setDurationEnd(e.target.value)}
                className="w-16 bg-background border border-border rounded px-1.5 py-0.5 text-xs font-mono text-center focus:outline-none focus:ring-1 focus:ring-primary"
                maxLength={8}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setShowDuration(false)
                }}
              />
            </div>
            <button
              className="text-xs text-primary hover:text-primary/80 transition-colors font-medium"
              onClick={() => setShowDuration(false)}
            >
              Done
            </button>
            <button
              className="text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              onClick={clearDuration}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe an edit... (Enter to send)"
          className="min-h-16 resize-none bg-secondary/30 text-sm"
          disabled={isLoading}
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              className={cn(
                'flex items-center gap-1.5 text-xs rounded-md px-2 py-1 transition-colors',
                showDuration || hasDuration
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50',
              )}
              onClick={() => setShowDuration((v) => !v)}
              title="Attach a time range to focus this edit on a specific segment"
            >
              <Clock className="h-3.5 w-3.5" />
              <span>+ Duration</span>
            </button>
            <button
              className={cn(
                'flex items-center gap-1.5 text-xs rounded-md px-2 py-1 transition-colors',
                showVoiceRecorder
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50',
              )}
              onClick={() => setShowVoiceRecorder((v) => !v)}
              title="Record voice, transcribe, or convert to AI voiceover"
            >
              <Mic className="h-3.5 w-3.5" />
              <span>Voice</span>
            </button>
          </div>

          <Button
            size="sm"
            className="h-7 gap-1.5"
            onClick={() => {
              void handleSend()
            }}
            disabled={!input.trim() || isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {isLoading ? 'Working...' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  )
})

const ToolStepsList = memo(function ToolStepsList({ steps }: { steps: ToolStep[] }) {
  if (steps.length === 0) return null
  return (
    <div className="mt-1.5 space-y-1">
      {steps.map((step) => (
        <div key={step.id} className="flex items-start gap-1.5 text-[11px]">
          {step.status === 'running' && (
            <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0 mt-0.5" />
          )}
          {step.status === 'done' && (
            <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" />
          )}
          {step.status === 'error' && (
            <AlertCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
          )}
          <div className="flex flex-col gap-0.5 min-w-0">
            <span
              className={cn(
                'font-medium truncate',
                step.status === 'running' && 'text-primary',
                step.status === 'done' && 'text-muted-foreground',
                step.status === 'error' && 'text-destructive',
              )}
            >
              {step.description}
            </span>
            {step.summary && step.status === 'done' && (
              <span className="text-muted-foreground/70 truncate">{step.summary}</span>
            )}
            {step.error && <span className="text-destructive/80 truncate">{step.error}</span>}
          </div>
        </div>
      ))}
    </div>
  )
})

const ClarificationCard = memo(function ClarificationCard({
  question,
  options,
  onAnswer,
}: {
  question: string
  options?: string[]
  onAnswer: (answer: string) => void
}) {
  const [custom, setCustom] = useState('')
  return (
    <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5 space-y-2">
      <p className="text-xs font-medium text-primary/90 flex items-center gap-1.5">
        <Wrench className="h-3 w-3" />
        {question}
      </p>
      {options && options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => onAnswer(opt)}
              className="px-2.5 py-1 text-xs rounded-md bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 transition-colors"
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Or type your answer..."
          className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && custom.trim()) {
              onAnswer(custom.trim())
              setCustom('')
            }
          }}
        />
        <button
          onClick={() => {
            if (custom.trim()) {
              onAnswer(custom.trim())
              setCustom('')
            }
          }}
          className="px-2 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  )
})

const MessageBubble = memo(function MessageBubble({
  message,
  onRestore,
  onClarificationAnswer,
}: {
  message: ChatMessage
  onRestore?: () => void
  onClarificationAnswer?: (answer: string) => void
}) {
  const isUser = message.role === 'user'
  const displayContent = message.content.replace(/^\[Segment [^\]]+\]\s*/, '')
  const segmentMatch = message.content.match(/^\[Segment ([^\]]+)\]/)

  return (
    <div className={cn('flex items-start gap-2', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary',
        )}
      >
        {isUser ? 'You' : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className={cn('flex max-w-[85%] flex-col gap-1', isUser && 'items-end')}>
        {isUser && segmentMatch && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-mono w-fit">
            <Clock className="h-2.5 w-2.5" />
            {segmentMatch[1]}
          </div>
        )}
        <div
          className={cn(
            'rounded-lg px-3 py-2 text-sm w-full',
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'border border-border bg-secondary/30 text-foreground',
          )}
        >
          {/* Tool steps — shown above the reply text */}
          {!isUser && message.toolSteps && message.toolSteps.length > 0 && (
            <ToolStepsList steps={message.toolSteps} />
          )}

          {/* Reply text */}
          {displayContent && (
            <p
              className={cn(
                'whitespace-pre-wrap leading-relaxed',
                !isUser && message.toolSteps && message.toolSteps.length > 0 && 'mt-2',
              )}
            >
              {displayContent}
            </p>
          )}

          {/* Show spinner when loading and no content yet */}
          {!isUser && !displayContent && (!message.toolSteps || message.toolSteps.length === 0) && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}

          {message.commandCount !== undefined && message.commandCount > 0 && (
            <p className="mt-1 text-[11px] opacity-60">
              {message.commandCount} edit{message.commandCount !== 1 ? 's' : ''} applied
            </p>
          )}

          {/* Clarification card */}
          {!isUser && message.pendingClarification && onClarificationAnswer && (
            <ClarificationCard
              question={message.pendingClarification.question}
              options={message.pendingClarification.options}
              onAnswer={onClarificationAnswer}
            />
          )}
        </div>
        {onRestore && (
          <button
            onClick={onRestore}
            className="flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
            title="Restore timeline to before this edit"
          >
            <RotateCcw className="h-3 w-3" />
            Restore
          </button>
        )}
      </div>
    </div>
  )
})
