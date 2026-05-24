import { memo, useEffect, useRef, useState } from 'react'
import { Bot, Send, Trash2, X, KeyRound, CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { cn } from '@/shared/ui/cn'
import { useAiChatStore } from '../stores/ai-chat-store'
import type { ChatMessage } from '../stores/ai-chat-store'

export const ChatPanel = memo(function ChatPanel({ onClose }: { onClose?: () => void }) {
  const { messages, isLoading, error, apiKey, sendMessage, clearMessages, setApiKey } =
    useAiChatStore()

  const [input, setInput] = useState('')
  const [keyInput, setKeyInput] = useState(apiKey)
  const [showKeyInput, setShowKeyInput] = useState(!apiKey)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, isLoading])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')
    await sendMessage(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const handleSaveKey = () => {
    setApiKey(keyInput.trim())
    setShowKeyInput(false)
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
            onClick={() => setShowKeyInput((v) => !v)}
            title="API key settings"
          >
            <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
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

      {/* API key input */}
      {showKeyInput && (
        <div className="shrink-0 border-b border-border bg-secondary/30 p-3 space-y-2">
          <p className="text-xs text-muted-foreground">Anthropic API key (stored locally)</p>
          <div className="flex gap-2">
            <Input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-ant-..."
              className="h-7 text-xs font-mono"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveKey()
              }}
            />
            <Button size="sm" className="h-7 px-2 gap-1 shrink-0" onClick={handleSaveKey}>
              <CheckCircle2 className="h-3 w-3" />
              Save
            </Button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && !isLoading && (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
            <Bot className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Describe what you want to do with your video.
            </p>
            <div className="space-y-1 text-xs text-muted-foreground/70">
              <p>"Add a caption at 0:14: Upload any contract"</p>
              <p>"Remove the pause at 0:45"</p>
              <p>"Speed up the middle section by 1.5x"</p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isLoading && (
          <div className="flex items-start gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Bot className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border p-3 space-y-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe an edit... (Enter to send)"
          className="min-h-16 resize-none bg-secondary/30 text-sm"
          disabled={isLoading}
        />
        <div className="flex justify-end">
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
            {isLoading ? 'Thinking...' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  )
})

const MessageBubble = memo(function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
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
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'border border-border bg-secondary/30 text-foreground',
        )}
      >
        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
        {message.commandCount !== undefined && message.commandCount > 0 && (
          <p className="mt-1 text-[11px] opacity-60">
            {message.commandCount} edit{message.commandCount !== 1 ? 's' : ''} applied
          </p>
        )}
      </div>
    </div>
  )
})
