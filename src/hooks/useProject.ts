"use client"

import { useCallback, useEffect } from "react"
import { invoke } from "@/lib/tauri"
import { useProjectStore } from "@/stores/projectStore"
import type { Project } from "@/lib/types"

export function useProject() {
  const { projects, activeProjectId, setProjects, setActiveProject, addProject, removeProject } =
    useProjectStore()

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null

  const fetchProjects = useCallback(async () => {
    try {
      const list = await invoke<Project[]>("list_projects")
      setProjects(list)
    } catch (err) {
      console.error("Failed to fetch projects:", err)
    }
  }, [setProjects])

  const addLocalProject = useCallback(
    async (path: string) => {
      try {
        const project = await invoke<Project>("add_local_project", { path })
        addProject(project)
        return project
      } catch (err) {
        console.error("Failed to add project:", err)
        throw err
      }
    },
    [addProject]
  )

  const deleteProject = useCallback(
    async (id: string) => {
      try {
        await invoke("delete_project", { id })
        removeProject(id)
        if (activeProjectId === id) {
          setActiveProject(null)
        }
      } catch (err) {
        console.error("Failed to delete project:", err)
        throw err
      }
    },
    [removeProject, activeProjectId, setActiveProject]
  )

  const openInEditor = useCallback(async (editor: string, path: string) => {
    try {
      await invoke("open_in_editor", { editor, path })
    } catch (err) {
      console.error("Failed to open in editor:", err)
      throw err
    }
  }, [])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  return {
    projects,
    activeProject,
    activeProjectId,
    setActiveProject,
    fetchProjects,
    addLocalProject,
    deleteProject,
    openInEditor,
  }
}
