"use client"

import { Component, ReactNode } from "react"

interface DiffErrorBoundaryProps {
  children: ReactNode
  filePath: string
  onError?: (filePath: string) => void
  fallback?: ReactNode
}

interface DiffErrorBoundaryState {
  hasError: boolean
  error?: Error
}

/**
 * 捕获 diff 渲染过程中的 Shiki 错误
 * 当遇到 "Invalid decoration position" 等错误时，自动降级到纯文本模式
 */
export class DiffErrorBoundary extends Component<
  DiffErrorBoundaryProps,
  DiffErrorBoundaryState
> {
  constructor(props: DiffErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): DiffErrorBoundaryState {
    // 检查是否是 Shiki 相关的错误
    const isShikiError =
      error.message.includes("Invalid decoration position") ||
      error.message.includes("normalizePosition") ||
      error.message.includes("ShikiError")

    if (isShikiError) {
      return { hasError: true, error }
    }

    // 如果不是 Shiki 错误，仍然抛出让上层处理
    throw error
  }

  componentDidCatch(error: Error) {
    console.warn(`Diff 渲染错误 (${this.props.filePath}):`, error.message)

    // 通知父组件禁用该文件的高亮
    if (this.props.onError) {
      this.props.onError(this.props.filePath)
    }
  }

  render() {
    if (this.state.hasError) {
      // 返回 null，让父组件重新渲染为纯文本模式
      return null
    }

    return this.props.children
  }
}
