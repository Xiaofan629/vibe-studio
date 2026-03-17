"use client"

import { useMemo, useState } from "react"
import { convertFileSrc } from "@tauri-apps/api/core"
import { Expand, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface AgentImagePreviewProps {
  images: string[]
  onRemove: (index: number) => void
  className?: string
  projectPath?: string | null
}

function resolveImagePath(imagePath: string, projectPath?: string | null) {
  if (imagePath.startsWith("data:")) {
    return imagePath
  }
  if (
    imagePath.startsWith("http://") ||
    imagePath.startsWith("https://") ||
    imagePath.startsWith("asset:")
  ) {
    return imagePath
  }
  if (imagePath.startsWith("/")) {
    return imagePath
  }
  if (projectPath) {
    return `${projectPath}/${imagePath.replace(/^\.\//, "")}`
  }
  return imagePath
}

function getImageSource(imagePath: string, projectPath?: string | null) {
  const resolvedPath = resolveImagePath(imagePath, projectPath)
  if (
    resolvedPath.startsWith("data:") ||
    resolvedPath.startsWith("http://") ||
    resolvedPath.startsWith("https://") ||
    resolvedPath.startsWith("asset:")
  ) {
    return resolvedPath
  }
  return convertFileSrc(resolvedPath)
}

export function AgentImagePreview({
  images,
  onRemove,
  className,
  projectPath,
}: AgentImagePreviewProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const displayImages = useMemo(() => images.slice(0, 10), [images])

  if (displayImages.length === 0) {
    return null
  }

  return (
    <>
      <div className={cn("flex flex-wrap gap-2", className)}>
        {displayImages.map((imagePath, index) => (
          <div
            key={`${imagePath}-${index}`}
            className="group relative h-16 w-16 overflow-hidden rounded-xl border border-border bg-muted/40"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getImageSource(imagePath, projectPath)}
              alt={`Attachment ${index + 1}`}
              className="h-full w-full object-cover"
            />
            <button
              type="button"
              onClick={() => setSelectedIndex(index)}
              className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/45 group-hover:opacity-100"
            >
              <Expand className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onRemove(index)}
              className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white opacity-0 transition group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        {images.length > 10 && (
          <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-border bg-muted/40 text-xs text-muted-foreground">
            +{images.length - 10}
          </div>
        )}
      </div>

      {selectedIndex !== null && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-6"
          onClick={() => setSelectedIndex(null)}
        >
          <div className="relative max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setSelectedIndex(null)}
              className="absolute right-2 top-2 z-10 rounded-full bg-black/70 p-2 text-white"
            >
              <X className="h-4 w-4" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getImageSource(displayImages[selectedIndex], projectPath)}
              alt={`Preview ${selectedIndex + 1}`}
              className="max-h-[85vh] max-w-[90vw] rounded-2xl border border-white/10 object-contain"
            />
          </div>
        </div>
      )}
    </>
  )
}
