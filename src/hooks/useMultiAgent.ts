"use client"

import { useEffect, useRef } from "react"
import { listen } from "@/lib/tauri"
import { useMultiAgentStore } from "@/stores/multiAgentStore"
import type { AgentNode, AgentProcessStatus } from "@/lib/types"

interface MultiAgentEvent {
  type: "agent_spawned" | "agent_status_changed"
  agent?: AgentNode
  agentId?: string
  status?: AgentProcessStatus
}

export function useMultiAgent() {
  const store = useMultiAgentStore()
  const unlistenRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let cancelled = false

    const setup = async () => {
      const unlisten = await listen<MultiAgentEvent>("multi-agent:update", (event) => {
        if (cancelled) return
        if (event.type === "agent_spawned" && event.agent) {
          store.addAgent(event.agent)
        } else if (event.type === "agent_status_changed" && event.agentId && event.status) {
          store.updateAgentStatus(event.agentId, event.status)
        }
      })

      if (!cancelled) {
        unlistenRef.current = unlisten
      } else {
        unlisten()
      }
    }

    setup()
    return () => {
      cancelled = true
      unlistenRef.current?.()
    }
  }, [])

  return {
    agents: store.agents,
    activeView: store.activeView,
    setActiveView: store.setActiveView,
    timeline: store.getTimeline(),
    clearAgents: store.clearAgents,
  }
}
