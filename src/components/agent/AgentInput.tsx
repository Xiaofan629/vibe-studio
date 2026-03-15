"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Send, Square, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface AgentInputProps {
  disabled?: boolean
  isRunning?: boolean
  onSend?: (message: string) => void
  onStop?: () => void
  placeholder?: string
  hasUnresolvedComments?: boolean
}

export function AgentInput({
  disabled,
  isRunning,
  onSend,
  onStop,
  placeholder = "发送消息给 Agent...",
  hasUnresolvedComments = false,
}: AgentInputProps) {
  const [text, setText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const textRef = useRef(text)

  useEffect(() => {
    textRef.current = text
  }, [text])

  const handleSubmit = useCallback(() => {
    const trimmed = textRef.current.trim()
    if (!trimmed && !hasUnresolvedComments) return
    onSend?.(trimmed)
    setText("")
  }, [onSend, hasUnresolvedComments])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.nativeEvent.isComposing || e.key === "Process" || e.keyCode === 229) {
        return
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        if (!disabled || isRunning) {
          handleSubmit()
        }
      }
    },
    [disabled, isRunning, handleSubmit]
  )

  const hasContent = text.trim().length > 0 || hasUnresolvedComments

  return (
    <div className="p-4 pt-0">
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled && !isRunning}
          className="min-h-28 max-h-60 text-sm pr-12 resize-none bg-transparent pt-3 pb-10"
        />
        <div className="absolute left-2 right-24 bottom-2">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              title="附加文件"
              disabled={disabled}
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
        {isRunning && onStop ? (
          <div className="absolute right-2 bottom-2 flex items-center gap-1">
            <Button
              onClick={handleSubmit}
              disabled={!hasContent}
              variant="secondary"
              size="icon"
              className="h-8 w-8"
              title="加入队列"
            >
              <Send className="h-4 w-4" />
            </Button>
            <Button
              onClick={onStop}
              variant="destructive"
              size="icon"
              className="h-8 w-8"
              title="停止"
            >
              <Square className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={disabled || !hasContent}
            size="icon"
            className="absolute right-2 bottom-2"
            title="发送"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
