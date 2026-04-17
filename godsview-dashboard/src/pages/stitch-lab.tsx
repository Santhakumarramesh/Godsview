import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

type StitchTemplate = {
  id: string;
  title: string;
  category: string;
  hasScreen: boolean;
  hasHtml: boolean;
};

type StitchManifest = {
  count: number;
  categories: string[];
  templates: StitchTemplate[];
};

function buildHtmlPath(id: string): string {
  return `/stitch-mission-control/${id}/code.html`;
}

function buildImagePath(id: string): string {
  return `/stitch-mission-control/${id}/screen.png`;
}

export default function StitchLabPage() {
  const [activeId, setActiveId] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");

  const { data, isLoading, isError } = useQuery<StitchManifest>({
    queryKey: ["stitch-mission-control-manifest"],
    queryFn: async () => {
      const r = await fetch("/stitch-mission-control/manifest.json");
      if (!r.ok) throw new Error(`manifest fetch failed: ${r.status}`);
      return r.json();
    },
    staleTime: 60_000,
    retry: 1,
  });

  const templates = data?.templates ?? [];
  const categories = useMemo(() => ["All", ...(data?.categories ?? [])], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((item) => {
      if (categoryFilter !== "All" && item.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [templates, search, categoryFilter]);

  const active = useMemo(() => {
    if (!filtered.length) return null;
    const fromActive = filtered.find((item) => item.id === activeId);
    return fromActive ?? filtered[0];
  }, [filtered, activeId]);

  return (
    <div className="space-y-4">
      <div className="rounded border p-4" style={{ borderColor: "rgba(72,72,73,0.28)", backgroundColor: "#1a191b" }}>
        <div style={{ fontSize: "9px", color: "#767576", fontFamily: "Space Grotesk", letterSpacing: "0.18em", textTransform: "uppercase" }}>
          GodsView · Design Vault
        </div>
        <h1 className="text-2xl font-bold tracking-tight mt-1">Stitch Mission Control Pack</h1>
        <p className="mt-2" style={{ fontSize: "11px", color: "#adaaab", fontFamily: "Space Grotesk" }}>
          Connected full archive from <code>stitch_mission_control.zip</code>. Browse, filter, preview, and open raw Stitch outputs for implementation.
        </p>
        <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-2">
          <div className="rounded border px-3 py-2" style={{ borderColor: "rgba(72,72,73,0.22)", backgroundColor: "#121113" }}>
            <div style={{ fontSize: "8px", color: "#767576", fontFamily: "Space Grotesk", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Total Templates
            </div>
            <div style={{ fontSize: "16px", color: "#9cff93", fontFamily: "JetBrains Mono, monospace", marginTop: "4px" }}>
              {data?.count ?? 0}
            </div>
          </div>
          <div className="rounded border px-3 py-2" style={{ borderColor: "rgba(72,72,73,0.22)", backgroundColor: "#121113" }}>
            <div style={{ fontSize: "8px", color: "#767576", fontFamily: "Space Grotesk", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Categories
            </div>
            <div style={{ fontSize: "16px", color: "#669dff", fontFamily: "JetBrains Mono, monospace", marginTop: "4px" }}>
              {data?.categories?.length ?? 0}
            </div>
          </div>
          <div className="rounded border px-3 py-2" style={{ borderColor: "rgba(72,72,73,0.22)", backgroundColor: "#121113" }}>
            <div style={{ fontSize: "8px", color: "#767576", fontFamily: "Space Grotesk", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Filtered
            </div>
            <div style={{ fontSize: "16px", color: "#fbbf24", fontFamily: "JetBrains Mono, monospace", marginTop: "4px" }}>
              {filtered.length}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-4 space-y-3">
          <div className="rounded border p-3 space-y-2" style={{ borderColor: "rgba(72,72,73,0.25)", backgroundColor: "#1a191b" }}>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search template, id, category…"
              className="w-full rounded px-2 py-2 outline-none"
              style={{ fontSize: "11px", border: "1px solid rgba(72,72,73,0.35)", backgroundColor: "#0f1012", color: "#ffffff" }}
            />
            <div className="flex flex-wrap gap-1.5">
              {categories.map((category) => {
                const activeChip = categoryFilter === category;
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setCategoryFilter(category)}
                    className="rounded-full px-2 py-1"
                    style={{
                      fontSize: "8px",
                      fontFamily: "Space Grotesk",
                      letterSpacing: "0.08em",
                      border: `1px solid ${activeChip ? "rgba(156,255,147,0.5)" : "rgba(102,157,255,0.25)"}`,
                      backgroundColor: activeChip ? "rgba(156,255,147,0.12)" : "rgba(102,157,255,0.08)",
                      color: activeChip ? "#9cff93" : "#669dff",
                    }}
                  >
                    {category}
                  </button>
                );
              })}
            </div>
          </div>

          {isLoading ? (
            <div className="rounded border p-3" style={{ borderColor: "rgba(72,72,73,0.25)", backgroundColor: "#1a191b", color: "#adaaab", fontSize: "11px" }}>
              Loading Stitch manifest…
            </div>
          ) : null}
          {isError ? (
            <div className="rounded border p-3" style={{ borderColor: "rgba(255,113,98,0.4)", backgroundColor: "rgba(255,113,98,0.08)", color: "#ff7162", fontSize: "11px" }}>
              Failed to load Stitch manifest.
            </div>
          ) : null}

          {filtered.map((item) => {
            const activeCard = item.id === active?.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveId(item.id)}
                className="w-full text-left rounded border p-3 transition-all"
                style={{
                  borderColor: activeCard ? "rgba(156,255,147,0.45)" : "rgba(72,72,73,0.25)",
                  backgroundColor: activeCard ? "rgba(156,255,147,0.08)" : "#1a191b",
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div style={{ fontSize: "10px", color: "#9cff93", fontFamily: "Space Grotesk", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      {item.category}
                    </div>
                    <div className="mt-1" style={{ fontSize: "14px", color: "#fff", fontFamily: "Space Grotesk", fontWeight: 700 }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: "9px", color: "#767576", fontFamily: "JetBrains Mono, monospace", marginTop: "3px" }}>
                      {item.id}
                    </div>
                  </div>
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "14px", color: activeCard ? "#9cff93" : "#767576" }}
                  >
                    {activeCard ? "radio_button_checked" : "radio_button_unchecked"}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  {item.hasScreen ? (
                    <a
                      href={buildImagePath(item.id)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: "10px", color: "#669dff" }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      Screenshot
                    </a>
                  ) : null}
                  {item.hasHtml ? (
                    <a
                      href={buildHtmlPath(item.id)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: "10px", color: "#669dff" }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      HTML
                    </a>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>

        <div className="xl:col-span-8 space-y-3">
          {active ? (
            <>
              <div className="rounded border p-3" style={{ borderColor: "rgba(72,72,73,0.25)", backgroundColor: "#1a191b" }}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div style={{ fontSize: "9px", color: "#767576", fontFamily: "Space Grotesk", letterSpacing: "0.18em", textTransform: "uppercase" }}>
                      Active Template
                    </div>
                    <div style={{ fontSize: "15px", color: "#fff", fontFamily: "Space Grotesk", fontWeight: 700 }}>
                      {active.title}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {active.hasScreen ? (
                      <a
                        href={buildImagePath(active.id)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: "10px", color: "#9cff93", fontFamily: "JetBrains Mono, monospace" }}
                      >
                        Open PNG
                      </a>
                    ) : null}
                    {active.hasHtml ? (
                      <a
                        href={buildHtmlPath(active.id)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: "10px", color: "#669dff", fontFamily: "JetBrains Mono, monospace" }}
                      >
                        Open HTML
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>

              {active.hasScreen ? (
                <div className="rounded border overflow-hidden" style={{ borderColor: "rgba(72,72,73,0.25)", backgroundColor: "#111214" }}>
                  <img
                    src={buildImagePath(active.id)}
                    alt={`${active.title} screenshot`}
                    className="w-full h-auto block"
                  />
                </div>
              ) : null}

              {active.hasHtml ? (
                <div className="rounded border overflow-hidden" style={{ borderColor: "rgba(72,72,73,0.25)", backgroundColor: "#0e0e0f" }}>
                  <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: "rgba(72,72,73,0.25)" }}>
                    <span style={{ fontSize: "10px", color: "#adaaab", fontFamily: "Space Grotesk", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                      Live HTML Preview
                    </span>
                    <span style={{ fontSize: "10px", color: "#767576", fontFamily: "JetBrains Mono, monospace" }}>
                      {active.id}
                    </span>
                  </div>
                  <iframe
                    title={`stitch-preview-${active.id}`}
                    src={buildHtmlPath(active.id)}
                    style={{ width: "100%", height: "780px", border: "0", backgroundColor: "#0e0e0f" }}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded border p-4" style={{ borderColor: "rgba(72,72,73,0.25)", backgroundColor: "#1a191b", color: "#adaaab", fontSize: "11px" }}>
              No Stitch templates match the current filter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
