import { create } from "zustand"
import type { AgentNode, TimelineEntry, AgentProcessStatus } from "@/lib/types"

type MultiAgentView = "tree" | "panel" | "timeline"

interface MultiAgentState {
  agents: AgentNode[]
  activeView: MultiAgentView
  setAgents: (agents: AgentNode[]) => void
  addAgent: (agent: AgentNode) => void
  updateAgentStatus: (id: string, status: AgentProcessStatus) => void
  setActiveView: (view: MultiAgentView) => void
  getTimeline: () => TimelineEntry[]
  clearAgents: () => void
}

export const useMultiAgentStore = create<MultiAgentState>((set, get) => ({
  agents: [],
  activeView: "tree",
  setAgents: (agents) => set({ agents }),
  addAgent: (agent) =>
    set((state) => ({ agents: [...state.agents, agent] })),
  updateAgentStatus: (id, status) =>
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === id
          ? { ...a, status, completedAt: new Date().toISOString() }
          : a
      ),
    })),
  setActiveView: (view) => set({ activeView: view }),
  getTimeline: () => {
    const { agents } = get()
    return agents.map((a) => ({
      id: a.id,
      label: a.prompt?.slice(0, 30) ?? a.id.slice(0, 8),
      startTime: new Date(a.startedAt).getTime(),
      endTime: a.completedAt ? new Date(a.completedAt).getTime() : null,
      status: a.status,
      depth: a.depth,
      parentId: a.parentId,
    }))
  },
  clearAgents: () => set({ agents: [] }),
}))
