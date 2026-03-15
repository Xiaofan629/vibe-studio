"use client"

import { useTranslations } from "next-intl"
import { ArrowLeft, Monitor, Moon, Settings, Sun } from "lucide-react"
import Link from "next/link"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"

const THEMES = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "system", icon: Monitor, label: "System" },
]

export default function SettingsPage() {
  const t = useTranslations()
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 items-center gap-3 border-b border-border px-4">
        <Link
          href="/"
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Settings className="h-4 w-4" />
        <h1 className="font-semibold">{t("settings.title")}</h1>
      </header>

      <div className="mx-auto w-full max-w-2xl p-6">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-medium">{t("settings.theme")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            直接在这里切换外观，不再拆分子页面。
          </p>

          <div className="mt-4 flex gap-2">
            {THEMES.map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={cn(
                  "flex flex-1 flex-col items-center gap-2 rounded-xl border p-4 transition-colors",
                  theme === value
                    ? "border-primary bg-accent"
                    : "border-border hover:bg-accent/50"
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-xs">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
