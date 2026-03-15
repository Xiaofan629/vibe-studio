"use client"

import { useTranslations } from "next-intl"
import { ArrowLeft, Check, AlertCircle } from "lucide-react"
import Link from "next/link"
import { useState, useEffect } from "react"
import { invoke } from "@/lib/tauri"
import type { AgentInfo } from "@/lib/types"

export default function AgentsSettingsPage() {
  const t = useTranslations()
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [defaultAgent, setDefaultAgent] = useState<string>("claude_code")

  useEffect(() => {
    const load = async () => {
      try {
        const list = await invoke<AgentInfo[]>("discover_agents")
        setAgents(list)
        const saved = localStorage.getItem("vibe-studio:defaultAgent")
        if (saved) setDefaultAgent(saved)
      } catch {
        setAgents([
          { agentType: "claude_code", name: "Claude Code", available: false, version: null, path: null },
          { agentType: "gemini", name: "Gemini CLI", available: false, version: null, path: null },
          { agentType: "codex", name: "Codex", available: false, version: null, path: null },
        ])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleSetDefault = (agentType: string) => {
    setDefaultAgent(agentType)
    localStorage.setItem("vibe-studio:defaultAgent", agentType)
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 items-center gap-3 border-b border-border px-4">
        <Link
          href="/settings"
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-semibold">{t("settings.agents")}</h1>
      </header>

      <div className="mx-auto w-full max-w-2xl p-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <div className="space-y-3">
            {agents.map((agent, index) => (
              <div
                key={`${agent.agentType}-${index}`}
                className="flex items-center justify-between rounded-lg border border-border p-4"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium">{agent.name}</h3>
                    {defaultAgent === agent.agentType && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        默认
                      </span>
                    )}
                  </div>
                  {agent.version && (
                    <p className="text-xs text-muted-foreground">v{agent.version}</p>
                  )}
                  {agent.path && (
                    <p className="font-mono text-[10px] text-muted-foreground/60">
                      {agent.path}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {agent.available ? (
                    <>
                      <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-500">
                        <Check className="h-3 w-3" />
                        Available
                      </span>
                      {defaultAgent !== agent.agentType && (
                        <button
                          onClick={() => handleSetDefault(agent.agentType)}
                          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                        >
                          设为默认
                        </button>
                      )}
                    </>
                  ) : (
                    <span className="flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-500">
                      <AlertCircle className="h-3 w-3" />
                      Not found
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
