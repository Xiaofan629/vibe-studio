"use client"

import { useTranslations } from "next-intl"
import { ArrowLeft, Sun, Moon, Monitor } from "lucide-react"
import Link from "next/link"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"

const THEMES = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "system", icon: Monitor, label: "System" },
]

export default function AppearanceSettingsPage() {
  const t = useTranslations()
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 items-center gap-3 border-b border-border px-4">
        <Link
          href="/settings"
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-semibold">{t("settings.appearance")}</h1>
      </header>

      <div className="mx-auto w-full max-w-2xl p-6 space-y-6">
        {/* Theme */}
        <div>
          <h3 className="mb-3 text-sm font-medium">{t("settings.theme")}</h3>
          <div className="flex gap-2">
            {THEMES.map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={cn(
                  "flex flex-1 flex-col items-center gap-2 rounded-lg border p-4 transition-colors",
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
