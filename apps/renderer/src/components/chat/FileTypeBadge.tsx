import { FileCode, Globe, Shield, Terminal } from "lucide-react";

export function ReactAtomIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-11.5 -10.23174 23 20.46348" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="0" cy="0" r="2.05" fill="var(--accent)" />
      <g stroke="var(--accent)" strokeWidth="1" fill="none">
        <ellipse rx="11" ry="4.2" />
        <ellipse rx="11" ry="4.2" transform="rotate(60)" />
        <ellipse rx="11" ry="4.2" transform="rotate(120)" />
      </g>
    </svg>
  );
}

export function FileTypeBadge({ fileName, isCommand, isHttp, isSecurity, isBrowser }: { fileName: string; isCommand?: boolean; isHttp?: boolean; isSecurity?: boolean; isBrowser?: boolean }) {
  if (isBrowser) {
    return <Globe className="size-3 text-accent shrink-0" strokeWidth={2} />;
  }
  if (isSecurity) {
    return <Shield className="size-3 text-fg-dim shrink-0" strokeWidth={2} />;
  }
  if (isHttp) {
    return <Globe className="size-3 text-fg-dim shrink-0" strokeWidth={2} />;
  }
  if (isCommand) {
    return <Terminal className="size-3 text-fg-dim shrink-0" strokeWidth={2} />;
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".tsx") || lower.endsWith(".jsx")) {
    return <ReactAtomIcon className="size-3.5 shrink-0" />;
  }
  let label = "CODE";
  if (lower.endsWith(".ts")) label = "TS";
  else if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) label = "JS";
  else if (lower.endsWith(".py")) label = "PY";
  else if (lower.endsWith(".json")) label = "{}";
  else if (lower.endsWith(".css") || lower.endsWith(".scss")) label = "CSS";
  else if (lower.endsWith(".html")) label = "HTML";
  else if (lower.endsWith(".md") || lower.endsWith(".markdown")) label = "MD";
  else return <FileCode className="size-3.5 text-fg-dim shrink-0" strokeWidth={1.75} />;

  return (
    <span className="px-1 py-0.5 rounded text-[9px] font-bold font-mono text-fg-dim bg-canvas border border-line/60 leading-none select-none shrink-0">
      {label}
    </span>
  );
}
