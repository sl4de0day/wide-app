import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

export function MenuItem({
  icon,
  label,
  danger,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        "flex h-row-sm w-full items-center gap-2.5 rounded-md px-2.5 text-left text-meta transition-colors duration-100",
        danger ? "text-status-error hover:bg-status-error/15" : "text-fg hover:bg-hover",
      )}
    >
      <span className="flex size-icon-sm shrink-0 items-center justify-center">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-line" />;
}

export function PopoverMenu({
  anchor,
  onClose,
  align = "end",
  width = 208,
  children,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  align?: "start" | "end";
  width?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const height = ref.current?.offsetHeight ?? 120;
    const top = rect.bottom + 4 + height > window.innerHeight ? rect.top - height - 4 : rect.bottom + 4;
    const rawLeft = align === "end" ? rect.right - width : rect.left;
    const left = Math.min(Math.max(8, rawLeft), window.innerWidth - width - 8);
    setPosition({ top: Math.max(8, top), left });
  }, [anchor, align, width]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node) || anchor.contains(event.target as Node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="wide-enter-fade no-drag fixed z-[300] rounded-lg border border-line bg-raised p-1 shadow-xl"
      style={{ top: position?.top ?? -9999, left: position?.left ?? -9999, width }}
    >
      {children}
    </div>,
    document.body,
  );
}
