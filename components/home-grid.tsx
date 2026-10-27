"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Icon } from "@/components/icons";
import type { HomeApp, HomeTile } from "@/lib/home-apps";

/** One app tile (also used inside a folder). */
function AppTile({ a, onOpen }: { a: HomeApp; onOpen?: () => void }) {
  const inner = (
    <>
      <span className="app-ic" style={{ ["--c" as string]: a.color }}>
        <Icon name={a.icon} size={28} />
        {a.badge ? <span className="bdg">{a.badge > 99 ? "99+" : a.badge}</span> : null}
      </span>
      <span className="lbl">{a.label}</span>
    </>
  );
  return a.external ? (
    <a className="app" href={a.href} target="_blank" rel="noopener noreferrer" onClick={onOpen}>
      {inner}
    </a>
  ) : (
    <Link className="app" href={a.href} onClick={onOpen}>
      {inner}
    </Link>
  );
}

/** The home screen apps: everyday apps out front, the rest in folders that open in a panel. */
export function HomeGrid({ tiles }: { tiles: HomeTile[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const folder = tiles.find((t): t is Extract<HomeTile, { kind: "folder" }> => t.kind === "folder" && t.key === open) ?? null;

  useEffect(() => {
    if (!folder) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    panel.current?.querySelector<HTMLElement>("a, button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      opener.current?.focus();
    };
  }, [folder]);

  return (
    <>
      <div className="apps-grid">
        {tiles.map((t) =>
          t.kind === "app" ? (
            <AppTile key={t.app.key} a={t.app} />
          ) : (
            <button
              key={t.key}
              type="button"
              className="app"
              aria-haspopup="dialog"
              aria-label={`${t.label}: ${t.apps.length} apps${t.badge ? `, ${t.badge} waiting` : ""}`}
              onClick={(e) => {
                opener.current = e.currentTarget;
                setOpen(t.key);
              }}
            >
              <span className="app-ic folder" style={{ ["--c" as string]: t.color }}>
                <span className="mini">
                  {t.apps.slice(0, 4).map((a) => (
                    <span key={a.key} style={{ ["--c" as string]: a.color }}>
                      <Icon name={a.icon} size={13} />
                    </span>
                  ))}
                </span>
                {t.badge ? <span className="bdg">{t.badge > 99 ? "99+" : t.badge}</span> : null}
              </span>
              <span className="lbl">{t.label}</span>
            </button>
          ),
        )}
      </div>

      {folder ? (
        <div className="folder-scrim" onClick={() => setOpen(null)}>
          <div
            ref={panel}
            className="folder-panel"
            role="dialog"
            aria-modal="true"
            aria-label={folder.label}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row between" style={{ alignItems: "center" }}>
              <span className="folder-title">{folder.label}</span>
              <button type="button" className="iconbtn" aria-label="Close" onClick={() => setOpen(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="apps-grid">
              {folder.apps.map((a) => (
                <AppTile key={a.key} a={a} onOpen={() => setOpen(null)} />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
