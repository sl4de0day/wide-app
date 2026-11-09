import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { bridge } from "@/lib/bridge";
import { LANGUAGES, useT, type Language } from "@/lib/i18n";
import { THEMES, type ThemeId } from "@/lib/themes";
import { formatCombo } from "@/stores/commands";
import { cn, copyText } from "@/lib/utils";
import { DEFAULTS, useSettings } from "@/stores/settings";
import { promptText } from "@/stores/prompt";
import { toast } from "@/stores/toast";
import { useUpdate } from "@/stores/update";

const ABOUT_DESCRIPTION =
  "Wide App is an autonomous AI engineering assistant and chat companion powered by the Wide ecosystem. It lets you converse directly with AI coding models across your local projects, manage conversation sessions, and drive development through AI prompts.";
const ABOUT_REPO_URL = "https://github.com/sl4de0day/wide-ide";

const THEME_PREVIEW_LINES: { token: string; width: number }[][] = [
  [
    { token: "syn-keyword", width: 13 },
    { token: "syn-function", width: 22 },
    { token: "syn-punct", width: 5 },
  ],
  [
    { token: "syn-property", width: 10 },
    { token: "syn-string", width: 28 },
  ],
  [
    { token: "syn-number", width: 8 },
    { token: "syn-type", width: 15 },
    { token: "syn-comment", width: 12 },
  ],
];

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 border-b border-line py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-fg">{label}</p>
        {hint && <p className="pt-0.5 text-[11px] text-fg-faint">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function LanguagePicker({
  value,
  onChange,
}: {
  value: Language;
  onChange: (next: Language) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const current = LANGUAGES.find((language) => language.id === value) ?? LANGUAGES[0];
  const isBeta = (id: Language) => id !== "en" && id !== "tr";

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex w-44 items-center justify-between gap-2 rounded-md border border-line px-2 py-1 text-[12px] text-fg transition-colors duration-100 hover:bg-hover"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{current.label}</span>
          {isBeta(current.id) && (
            <span className="shrink-0 rounded-sm border border-line px-1 text-[9px] uppercase tracking-wide text-fg-faint">beta</span>
          )}
        </span>
        <ChevronDown
          className={cn("size-3.5 shrink-0 text-fg-faint transition-transform duration-100", open && "rotate-180")}
          strokeWidth={1.75}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-30 mt-1 max-h-64 w-44 overflow-auto rounded-md border border-line bg-raised py-0.5 shadow-lg"
        >
          {LANGUAGES.map((language) => (
            <button
              key={language.id}
              type="button"
              role="option"
              aria-selected={language.id === value}
              onClick={() => {
                onChange(language.id);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-1.5 px-2 py-1 text-left text-[12px] transition-colors duration-100",
                language.id === value
                  ? "bg-selected text-fg-bright"
                  : "text-fg-muted hover:bg-hover hover:text-fg",
              )}
            >
              <span className="truncate">{language.label}</span>
              {isBeta(language.id) && (
                <span className="ml-auto shrink-0 rounded-sm border border-line px-1 text-[9px] uppercase tracking-wide text-fg-faint">beta</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const EXTRA_SHORTCUTS: { combo: string; label: string }[] = [
  { combo: "ctrl+l", label: "New conversation" },
  { combo: "ctrl+,", label: "Settings" },
  { combo: "ctrl+=", label: "Zoom in" },
  { combo: "ctrl+-", label: "Zoom out" },
  { combo: "ctrl+0", label: "Reset zoom" },
];

function ShortcutsSection() {
  const t = useT();
  const line = (label: string, combo: string) => (
    <div key={label + combo} className="flex items-center justify-between py-1 text-[12px]">
      <span className="min-w-0 truncate text-fg-dim">{label}</span>
      <kbd className="ml-2 shrink-0 rounded-sm border border-line bg-panel px-1.5 py-0.5 text-[10px] text-fg-dim">{formatCombo(combo)}</kbd>
    </div>
  );
  return (
    <div className="border-b border-line py-2">
      {EXTRA_SHORTCUTS.map((s) => line(t(s.label), s.combo))}
    </div>
  );
}

function ThemePicker({
  value,
  onChange,
}: {
  value: ThemeId;
  onChange: (next: ThemeId) => void;
}) {
  const t = useT();
  return (
    <div role="radiogroup" className="flex w-full flex-col gap-1">
      {THEMES.map((theme) => (
        <button
          key={theme.id}
          type="button"
          role="radio"
          aria-checked={value === theme.id}
          onClick={() => onChange(theme.id)}
          className={cn(
            "flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors duration-100",
            value === theme.id
              ? "border-line-strong bg-selected"
              : "border-line hover:bg-hover",
          )}
        >
          <span
            data-theme={theme.id}
            className="flex shrink-0 flex-col justify-center gap-[3px] overflow-hidden rounded-sm border border-line px-2 py-2"
            style={{ background: "var(--canvas)", width: 82, height: 46 }}
            aria-hidden="true"
          >
            {THEME_PREVIEW_LINES.map((line, index) => (
              <span key={index} className="flex items-center gap-[3px]">
                {line.map((bar) => (
                  <span
                    key={bar.token}
                    className="block rounded-full"
                    style={{ background: `var(--${bar.token})`, width: bar.width, height: 3 }}
                  />
                ))}
              </span>
            ))}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] text-fg">{t(theme.label)}</span>
            <span className="block text-[11px] text-fg-faint">{t(theme.hint)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function UpdatesSection() {
  const t = useT();
  const current = useUpdate((state) => state.current);

  return (
    <>
      <h2 className="pt-6 text-[11px] uppercase tracking-wide text-fg-faint">{t("Updates")}</h2>
      <Row
        label={t("Automatic updates")}
        hint={t("Wide checks for updates on startup and installs them automatically from GitHub.")}
      >
        <span className="font-mono text-[12px] text-fg-dim">{current || "…"}</span>
      </Row>
    </>
  );
}

export function SettingsView() {
  const settings = useSettings();
  const t = useT();
  const aboutVersion = useUpdate((state) => state.current);

  useEffect(() => {
    if (!aboutVersion) void useUpdate.getState().check();
  }, [aboutVersion]);

  const exportSettings = async () => {
    const { set: _s, reset: _r, ...values } = useSettings.getState();
    const ok = await copyText(JSON.stringify(values, null, 2));
    if (ok) toast.success(t("Settings copied to the clipboard."));
    else toast.error(t("Could not copy the settings."));
  };
  const importSettings = async () => {
    const raw = await promptText({
      title: t("Import settings"),
      placeholder: t("Paste exported settings JSON"),
    });
    if (!raw || !raw.trim()) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") throw new Error("bad");
      const patch: Record<string, unknown> = {};
      for (const key of Object.keys(DEFAULTS)) {
        if (key in parsed) patch[key] = (parsed as Record<string, unknown>)[key];
      }
      settings.set(patch as Partial<typeof DEFAULTS>);
      toast.success(t("Settings imported."));
    } catch {
      toast.error(t("That is not valid settings JSON."));
    }
  };

  return (
    <div className="wide-enter-fade h-full overflow-auto px-6 py-5">
      <div className="mx-auto w-full max-w-[560px]">
        <h1 className="text-[16px] font-semibold text-fg-bright">{t("Settings")}</h1>

        <h2 className="pt-6 text-[11px] uppercase tracking-wide text-fg-faint">{t("Appearance")}</h2>
        <Row label={t("Language")} hint={t("The language of the interface.")}>
          <LanguagePicker
            value={settings.language}
            onChange={(next) => settings.set({ language: next })}
          />
        </Row>
        {}
        <div className="border-b border-line py-3">
          <p className="pb-2 text-[13px] text-fg">{t("Theme")}</p>
          <ThemePicker
            value={settings.theme}
            onChange={(next) => settings.set({ theme: next })}
          />
        </div>
        <Row label="Follow system theme" hint="Automatically adapt when OS switches dark/light mode.">
          <input
            type="checkbox"
            checked={settings.followSystemTheme}
            onChange={(e) => settings.set({ followSystemTheme: e.target.checked })}
            className="size-4 rounded accent-accent"
          />
        </Row>

        <h2 className="pt-6 text-[11px] uppercase tracking-wide text-fg-faint">{t("Keyboard Shortcuts")}</h2>
        <ShortcutsSection />

        <UpdatesSection />

        <h2 className="pt-6 text-[11px] uppercase tracking-wide text-fg-faint">{t("About")}</h2>
        <div className="border-b border-line py-3">
          <p className="text-[14px] font-semibold text-fg-bright">{t("About Wide App")}</p>
          <p className="pt-2 text-[12px] leading-relaxed text-fg-dim">{t(ABOUT_DESCRIPTION)}</p>
          <div className="flex flex-col gap-1.5 pt-3">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-fg-dim">{t("Version")}</span>
              <span className="font-mono text-fg">{aboutVersion || "…"}</span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-fg-dim">{t("Maker")}</span>
              <span className="font-mono text-fg">sl4de</span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-fg-dim">{t("License")}</span>
              <span className="font-mono text-fg">GPLv3</span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-fg-dim">GitHub</span>
              <button
                type="button"
                onClick={() => void bridge.openExternal(ABOUT_REPO_URL)}
                className="font-mono text-accent transition-colors duration-100 hover:underline"
              >
                sl4de0day/wide-ide
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void exportSettings()}
            className="rounded-md border border-line px-3 py-1.5 text-[12px] text-fg-muted transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            {t("Export settings")}
          </button>
          <button
            type="button"
            onClick={() => void importSettings()}
            className="rounded-md border border-line px-3 py-1.5 text-[12px] text-fg-muted transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            {t("Import settings")}
          </button>
          <button
            type="button"
            onClick={() => settings.reset()}
            className="rounded-md border border-line px-3 py-1.5 text-[12px] text-fg-muted transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            {t("Reset to defaults")}
          </button>
        </div>
      </div>
    </div>
  );
}
