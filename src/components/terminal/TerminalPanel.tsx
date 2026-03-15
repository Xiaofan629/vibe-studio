"use client"

import { useEffect, useRef } from "react"
import { invoke, listen } from "@/lib/tauri"

interface TerminalPanelProps {
  projectPath: string | null
  repoId?: string | null
  terminalKey?: string | null
  initialCommand?: string | null
  embedded?: boolean
}

interface TerminalOutput {
  id: string
  data: number[]
}

interface TerminalEntry {
  term: any
  fitAddon: any
  containerEl: HTMLDivElement
  terminalId: string
  unlisten?: () => void
  onDataDisposable?: { dispose: () => void }
  onResizeDisposable?: { dispose: () => void }
  removeCopyListeners?: () => void
  initialCommandRan: boolean
  ptyConnected: boolean
}

const terminalEntries = new Map<string, TerminalEntry>()
const INPUT_FLUSH_DELAY_MS = 16
const textEncoder = new TextEncoder()

function encodeTerminalData(data: string): number[] {
  return Array.from(textEncoder.encode(data))
}

function scheduleTerminalFit(entry: TerminalEntry, focus = false) {
  const fitOnce = () => {
    try {
      if (
        entry.containerEl.offsetWidth <= 0 ||
        entry.containerEl.offsetHeight <= 0
      ) {
        return
      }

      entry.fitAddon?.fit()

      const rows = Number(entry.term?.rows ?? 0)
      const cols = Number(entry.term?.cols ?? 0)

      if (entry.ptyConnected && cols > 0 && rows > 0) {
        invoke("resize_terminal", {
          terminalId: entry.terminalId,
          cols,
          rows,
        }).catch(() => {})
      }

      if (focus) {
        entry.term?.focus()
      }
    } catch {
      // Ignore transient fit errors while layout is settling.
    }
  }

  requestAnimationFrame(() => {
    fitOnce()
    window.setTimeout(fitOnce, 50)
  })
}

function getTerminalSelection(term: any): string {
  if (typeof term?.getSelection !== "function") {
    return ""
  }

  return term.getSelection()
}

async function writeClipboardText(text: string): Promise<boolean> {
  if (!text || typeof document === "undefined") {
    return false
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall back to the legacy copy path below.
    }
  }

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "true")
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  textarea.style.pointerEvents = "none"
  document.body.appendChild(textarea)
  textarea.select()

  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

function isCopyShortcut(event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== "c") {
    return false
  }

  const isMac =
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform)

  if (isMac) {
    return event.metaKey && !event.ctrlKey && !event.altKey
  }

  return event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey
}

function scheduleInitialCommand(
  entry: TerminalEntry,
  initialCommand?: string | null
) {
  if (!entry.ptyConnected || entry.initialCommandRan || !initialCommand) {
    return
  }

  entry.initialCommandRan = true

  window.setTimeout(() => {
    invoke("write_terminal", {
      terminalId: entry.terminalId,
      data: encodeTerminalData(`${initialCommand}\r`),
    }).catch(() => {
      entry.initialCommandRan = false
    })
  }, 180)
}

export function TerminalPanel({
  projectPath,
  repoId,
  terminalKey,
  initialCommand,
  embedded: _embedded,
}: TerminalPanelProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const activeRepoRef = useRef<string | null>(null)

  useEffect(() => {
    const resolvedKey = terminalKey ?? repoId
    if (!wrapperRef.current || !projectPath || !resolvedKey) {
      return
    }

    const wrapper = wrapperRef.current
    const cacheKey = resolvedKey
    const terminalId = `terminal-${resolvedKey}`

    activeRepoRef.current = cacheKey

    for (const [key, entry] of terminalEntries) {
      entry.containerEl.style.display = key === cacheKey ? "" : "none"
    }

    const existing = terminalEntries.get(cacheKey)
    if (existing) {
      if (existing.containerEl.parentElement !== wrapper) {
        wrapper.appendChild(existing.containerEl)
      }

      existing.containerEl.style.display = ""
      scheduleInitialCommand(existing, initialCommand)
      scheduleTerminalFit(existing, true)
      return
    }

    const containerEl = document.createElement("div")
    containerEl.style.cssText =
      "width:100%;height:100%;position:absolute;top:0;left:0"
    wrapper.appendChild(containerEl)

    const entry: TerminalEntry = {
      term: null,
      fitAddon: null,
      containerEl,
      terminalId,
      initialCommandRan: false,
      ptyConnected: false,
    }

    terminalEntries.set(cacheKey, entry)

    const initTerminal = async () => {
      try {
        const { Terminal } = await import("@xterm/xterm")
        const { FitAddon } = await import("@xterm/addon-fit")

        if (activeRepoRef.current !== cacheKey) {
          containerEl.style.display = "none"
        }

        const term = new Terminal({
          theme: {
            background: "hsl(var(--background))",
            foreground: "hsl(var(--foreground))",
            cursor: "hsl(var(--primary))",
          },
          fontSize: 13,
          fontFamily:
            '"Sarasa Mono SC", "Noto Sans Mono CJK SC", "Cascadia Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          lineHeight: 1.08,
          letterSpacing: 0,
          rescaleOverlappingGlyphs: true,
          cursorBlink: true,
          rightClickSelectsWord: true,
        })

        const fitAddon = new FitAddon()
        term.loadAddon(fitAddon)

        entry.term = term
        entry.fitAddon = fitAddon

        const fontsReady = containerEl.ownerDocument?.fonts?.ready
        if (fontsReady) {
          await fontsReady.catch(() => {})
        }

        await new Promise<void>((resolve) => {
          const openWhenVisible = () => {
            if (
              containerEl.offsetWidth > 0 &&
              containerEl.offsetHeight > 0
            ) {
              term.open(containerEl)
              requestAnimationFrame(() => {
                try {
                  fitAddon.fit()
                } catch {
                  // Ignore the first fit if layout is still settling.
                }
                resolve()
              })
              return
            }

            requestAnimationFrame(openWhenVisible)
          }

          requestAnimationFrame(openWhenVisible)
        })

        const copySelection = async () => {
          const selection = getTerminalSelection(term)
          if (!selection) {
            return false
          }

          return writeClipboardText(selection)
        }

        const handleCopy = (event: ClipboardEvent) => {
          const selection = getTerminalSelection(term)
          if (!selection) {
            return
          }

          event.preventDefault()
          event.clipboardData?.setData("text/plain", selection)
          void writeClipboardText(selection)
        }

        containerEl.addEventListener("copy", handleCopy)
        term.textarea?.addEventListener("copy", handleCopy)
        entry.removeCopyListeners = () => {
          containerEl.removeEventListener("copy", handleCopy)
          term.textarea?.removeEventListener("copy", handleCopy)
        }

        try {
          await invoke("create_terminal", {
            terminalId,
            cwd: projectPath,
            cols: term.cols,
            rows: term.rows,
          })

          const unlisten = await listen<TerminalOutput>(
            "terminal:output",
            (payload) => {
              if (payload.id === terminalId) {
                term.write(new Uint8Array(payload.data))
              }
            }
          )

          let bufferedInput = ""
          let bufferedFlushTimer: number | null = null

          const flushBufferedInput = () => {
            if (!bufferedInput) {
              bufferedFlushTimer = null
              return
            }

            const payload = bufferedInput
            bufferedInput = ""
            bufferedFlushTimer = null
            void invoke("write_terminal", {
              terminalId,
              data: encodeTerminalData(payload),
            }).catch(() => {})
          }

          const scheduleBufferedFlush = () => {
            if (bufferedFlushTimer != null) {
              return
            }

            bufferedFlushTimer = window.setTimeout(() => {
              flushBufferedInput()
            }, INPUT_FLUSH_DELAY_MS)
          }

          term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
            if (event.type !== "keydown") {
              return true
            }

            if (isCopyShortcut(event) && getTerminalSelection(term)) {
              void copySelection()
              event.preventDefault()
              return false
            }

            return true
          })

          const onDataDisposable = term.onData((data: string) => {
            bufferedInput += data
            scheduleBufferedFlush()
          })

          const onResizeDisposable = term.onResize(
            ({ cols, rows }: { cols: number; rows: number }) => {
              invoke("resize_terminal", {
                terminalId,
                cols,
                rows,
              }).catch(() => {})
            }
          )

          entry.unlisten = unlisten
          entry.onDataDisposable = onDataDisposable
          entry.onResizeDisposable = onResizeDisposable
          entry.ptyConnected = true

          scheduleInitialCommand(entry, initialCommand)
          scheduleTerminalFit(entry)
        } catch {
          term.writeln(`\x1b[34m$ cd ${projectPath}\x1b[0m`)
          term.writeln("Terminal ready. (PTY requires Tauri desktop environment)")
        }

        if (activeRepoRef.current === cacheKey) {
          scheduleTerminalFit(entry, true)
        }
      } catch {
        // xterm not available during SSG.
      }
    }

    void initTerminal()
  }, [initialCommand, projectPath, repoId, terminalKey])

  useEffect(() => {
    if (!wrapperRef.current) {
      return
    }

    const resizeObserver = new ResizeObserver(() => {
      const activeKey = activeRepoRef.current
      if (!activeKey) {
        return
      }

      const entry = terminalEntries.get(activeKey)
      if (entry) {
        scheduleTerminalFit(entry)
      }
    })

    resizeObserver.observe(wrapperRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  if (!projectPath) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>选择项目后使用终端</p>
      </div>
    )
  }

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full overflow-hidden"
    />
  )
}
