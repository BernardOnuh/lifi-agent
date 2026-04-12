"use client";
import { useState, useEffect } from "react";

type Analysis = {
  stack: string;
  hasWagmi: boolean;
  hasEthers: boolean;
  hasViem: boolean;
  chains: string[];
  tokens: string[];
  existingDeps: string[];
  entryFile: string;
  summary: string;
};

type GeneratedFile = { filename: string; content: string };
type GenerateResult = { files: GeneratedFile[]; packageInstall: string; envVars: string[] };

const STEPS = [
  { id: "input", label: "01 Share" },
  { id: "analysed", label: "02 Analyse" },
  { id: "generated", label: "03 Integrate" },
];

const HERO_TEXT = "Integrate LI.FI into any project";

const FLOW_NODES: Array<
  | { arrow: string }
  | { label: string; sub: string; accent?: boolean; strong?: boolean }
> = [
  { label: "Your dApp", sub: "any stack", strong: true },
  { arrow: "→ analyse →" },
  { label: "AI Agent", sub: "reads deps", accent: true },
  { arrow: "→ generate →" },
  { label: "LI.FI SDK", sub: "typed files" },
  { arrow: "→ bridge →" },
  { label: "20+ Chains", sub: "multichain" },
];

const S = {
  bg: "#070709",
  surface: "#0D0D11",
  border: "rgba(255,255,255,0.07)",
  borderHover: "rgba(255,255,255,0.14)",
  text: "#EEEDF5",
  muted: "rgba(238,237,245,0.38)",
  accent: "#B5FF47",
  accentDim: "rgba(181,255,71,0.10)",
  blue: "#5B8DEF",
  blueDim: "rgba(91,141,239,0.08)",
} as const;

const mono = "'JetBrains Mono', monospace";
const sans = "'Archivo', system-ui, sans-serif";

const INTEGRATION_FILENAMES = new Set([
  "lib/lifi/config.ts",
  "hooks/useLiFiRoute.ts",
  "hooks/useLiFiSwap.ts",
  "LIFI_INTEGRATION.md",
]);

export default function Home() {
  const [activeTab, setActiveTab] = useState<"paste" | "url">("paste");
  const [code, setCode] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [originalFiles, setOriginalFiles] = useState<GeneratedFile[]>([]);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [step, setStep] = useState<"input" | "analysed" | "generated">("input");
  const [error, setError] = useState("");
  const [typedLen, setTypedLen] = useState(0);
  const [cursor, setCursor] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    let i = 0;
    const iv = setInterval(() => {
      i++;
      setTypedLen(i);
      if (i >= HERO_TEXT.length) clearInterval(iv);
    }, 38);
    return () => clearInterval(iv);
  }, [mounted]);

  useEffect(() => {
    const iv = setInterval(() => setCursor(c => !c), 530);
    return () => clearInterval(iv);
  }, []);

  async function handleAnalyse() {
    setLoading(true);
    setError("");
    try {
      setLoadingText("Scanning project");
      const input = activeTab === "paste" ? code : repoUrl;
      const res = await fetch("/api/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: input }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAnalysis(data.analysis);
      setOriginalFiles(data.originalFiles ?? []);
      setStep("analysed");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate() {
    setLoading(true);
    setError("");
    try {
      setLoadingText("Generating integration");
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis, originalFiles }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data.result);
      setStep("generated");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    result?.files.forEach(f => {
      if ((f as GeneratedFile & { binary?: boolean }).binary) {
        // Decode base64 binary files (images, fonts, etc.)
        zip.file(f.filename, f.content, { base64: true });
      } else {
        zip.file(f.filename, f.content);
      }
    });
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lifi-integrated-project.zip";
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyToClipboard(text: string, btn: HTMLButtonElement) {
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent;
      btn.textContent = "✓ copied";
      btn.style.color = S.accent;
      btn.style.borderColor = S.accent;
      setTimeout(() => {
        btn.textContent = orig;
        btn.style.color = "";
        btn.style.borderColor = "";
      }, 1200);
    });
  }

  if (!mounted) return null;

  const stepIndex = STEPS.findIndex(s => s.id === step);
  const hasInput = activeTab === "paste" ? !!code : !!repoUrl;
  const typed = HERO_TEXT.slice(0, typedLen);

  const newFiles = result?.files.filter(f => INTEGRATION_FILENAMES.has(f.filename)) ?? [];
  const originalProjectFiles = result?.files.filter(f => !INTEGRATION_FILENAMES.has(f.filename)) ?? [];

  return (
    <main style={{ minHeight: "100vh", background: S.bg, color: S.text, fontFamily: sans, position: "relative", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500;700&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: rgba(181,255,71,0.25); }
        textarea, input { outline: none; color: #EEEDF5; }
        @keyframes scanline { 0% { transform: translateY(-100%); } 100% { transform: translateY(120vh); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes flow { 0% { left: -40%; } 100% { left: 120%; } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        .fade-up { animation: fadeUp 0.45s ease both; }
      `}</style>

      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", backgroundImage: "linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px)", backgroundSize: "40px 40px", zIndex: 0 }} />
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, transparent, rgba(181,255,71,0.05), transparent)", animation: "scanline 9s linear infinite", pointerEvents: "none", zIndex: 1 }} />

      {/* Header */}
      <header style={{ position: "sticky", top: 0, zIndex: 100, height: 52, borderBottom: `1px solid ${S.border}`, padding: "0 28px", display: "flex", alignItems: "center", justifyContent: "space-between", backdropFilter: "blur(20px)", background: "rgba(7,7,9,0.92)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 26, height: 26, background: S.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 900, color: "#000" }}>L</div>
          <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.02em" }}>LI.FI Agent</span>
          <span style={{ fontFamily: mono, fontSize: 11, color: S.muted }}>v2.0</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 6, height: 6, background: S.accent, animation: "pulse 2s infinite" }} />
          <span style={{ fontFamily: mono, fontSize: 11, color: S.accent, letterSpacing: "0.08em" }}>LIVE</span>
        </div>
      </header>

      <div style={{ position: "relative", zIndex: 10, maxWidth: 720, margin: "0 auto", padding: "36px 20px 80px" }}>

        {/* Hero */}
        {step === "input" && (
          <div className="fade-up" style={{ padding: "52px 0 44px" }}>
            <div style={{ display: "inline-flex", alignItems: "center", borderLeft: `2px solid ${S.accent}`, paddingLeft: 12, marginBottom: 26, fontFamily: mono, fontSize: 11, color: S.accent, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Cross-chain integration agent
            </div>
            <h1 style={{ fontSize: "clamp(32px, 5.5vw, 52px)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.02, marginBottom: 18, fontFamily: sans }}>
              {typed}<span style={{ color: S.accent, opacity: cursor ? 1 : 0 }}>_</span>
            </h1>
            <p style={{ fontSize: 15, color: S.muted, maxWidth: 480, lineHeight: 1.75 }}>
              Paste your code or drop a GitHub URL — the agent reads your full project and returns it with LI.FI already integrated and ready to run.
            </p>
          </div>
        )}

        {/* Stepper */}
        <div style={{ display: "flex", alignItems: "center", borderBottom: `1px solid ${S.border}`, marginBottom: 28 }}>
          {STEPS.map((s, i) => {
            const done = i < stepIndex;
            const active = i === stepIndex;
            return (
              <div key={s.id} style={{ padding: "10px 0", marginRight: 28, marginBottom: -1, borderBottom: `2px solid ${active || done ? S.accent : "transparent"}`, fontFamily: mono, fontSize: 11, color: active ? S.text : done ? S.accent : S.muted, fontWeight: active ? 700 : 400, letterSpacing: "0.05em", transition: "all 0.3s" }}>
                {s.label}{done && <span style={{ color: S.accent, marginLeft: 6 }}>✓</span>}
              </div>
            );
          })}
        </div>

        {/* Flow diagram */}
        {step === "input" && (
          <div style={{ border: `1px solid ${S.border}`, background: S.surface, marginBottom: 24 }}>
            <div style={{ padding: "12px 20px", borderBottom: `1px solid ${S.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontFamily: mono, fontSize: 10, color: S.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>integration flow</span>
              <div style={{ display: "flex", gap: 5 }}>
                {["ETH", "POL", "ARB", "OP", "BASE"].map(c => (
                  <span key={c} style={{ fontFamily: mono, fontSize: 9, padding: "2px 6px", border: `1px solid ${S.border}`, color: S.muted }}>{c}</span>
                ))}
              </div>
            </div>
            <div style={{ padding: "20px" }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                {FLOW_NODES.map((node, i) => {
                  if ("arrow" in node) {
                    return (
                      <div key={i} style={{ flex: 1, position: "relative", height: 32, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                        <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: `linear-gradient(90deg, ${S.border}, rgba(181,255,71,0.12), ${S.border})`, marginTop: -0.5 }} />
                        <div style={{ position: "absolute", top: "50%", width: "35%", height: 2, background: `linear-gradient(90deg, transparent, ${S.accent})`, animation: `flow 2.2s linear infinite`, marginTop: -1 }} />
                        <span style={{ position: "relative", background: S.surface, padding: "0 6px", fontFamily: mono, fontSize: 9, color: S.muted }}>{node.arrow}</span>
                      </div>
                    );
                  }
                  return (
                    <div key={i} style={{ padding: "12px 14px", textAlign: "center", border: `1px solid ${node.accent ? S.accent : node.strong ? S.borderHover : S.border}`, background: node.accent ? S.accentDim : "transparent", minWidth: 88, flexShrink: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: node.accent ? S.accent : S.text, marginBottom: 3 }}>{node.label}</div>
                      <div style={{ fontFamily: mono, fontSize: 9, color: S.muted }}>{node.sub}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── INPUT ── */}
        {step === "input" && (
          <div className="fade-up" style={{ border: `1px solid ${S.border}`, background: S.surface }}>
            <div style={{ display: "flex", borderBottom: `1px solid ${S.border}` }}>
              {(["paste", "url"] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: "12px 20px", background: "transparent", border: "none", borderBottom: `2px solid ${activeTab === tab ? S.accent : "transparent"}`, fontFamily: mono, fontSize: 11, fontWeight: 700, color: activeTab === tab ? S.text : S.muted, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: -1, cursor: "pointer", transition: "all 0.2s" }}>
                  {tab === "paste" ? "paste_code" : "github_url"}
                </button>
              ))}
            </div>
            <div style={{ padding: 20 }}>
              {activeTab === "paste" ? (
                <div style={{ position: "relative" }}>
                  <div style={{ position: "absolute", top: 13, left: 14, fontFamily: mono, fontSize: 11, color: "rgba(238,237,245,0.18)", pointerEvents: "none", userSelect: "none", lineHeight: "1.65em" }}>
                    {Array.from({ length: 11 }, (_, i) => <div key={i}>{String(i + 1).padStart(2, "0")}</div>)}
                  </div>
                  <textarea value={code} onChange={e => setCode(e.target.value)} rows={11} placeholder="// paste package.json, hooks, components..." style={{ width: "100%", background: "rgba(0,0,0,0.35)", border: `1px solid ${S.border}`, padding: "12px 14px 12px 44px", fontFamily: mono, fontSize: 12, resize: "none", lineHeight: 1.65, transition: "border-color 0.2s" }} onFocus={e => (e.target.style.borderColor = S.borderHover)} onBlur={e => (e.target.style.borderColor = S.border)} />
                </div>
              ) : (
                <input type="text" value={repoUrl} onChange={e => setRepoUrl(e.target.value)} placeholder="https://github.com/username/repo" style={{ width: "100%", padding: "12px 14px", background: "rgba(0,0,0,0.35)", border: `1px solid ${S.border}`, fontFamily: mono, fontSize: 13, transition: "border-color 0.2s" }} onFocus={e => (e.target.style.borderColor = S.borderHover)} onBlur={e => (e.target.style.borderColor = S.border)} />
              )}
              {error && <div style={{ marginTop: 12, padding: "10px 14px", border: "1px solid rgba(255,80,80,0.2)", background: "rgba(255,80,80,0.05)", fontFamily: mono, fontSize: 12, color: "#ff6b6b" }}>✗ {error}</div>}
              <button onClick={handleAnalyse} disabled={loading || !hasInput} style={{ marginTop: 14, width: "100%", padding: "14px 0", background: hasInput ? S.accent : "transparent", border: `1px solid ${hasInput ? S.accent : S.border}`, color: hasInput ? "#000" : S.muted, fontFamily: mono, fontSize: 12, fontWeight: 900, letterSpacing: "0.07em", textTransform: "uppercase", opacity: loading ? 0.7 : 1, cursor: loading || !hasInput ? "not-allowed" : "pointer", transition: "all 0.2s" }}>
                {loading ? `${loadingText}…` : "→ Analyse project"}
              </button>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 16 }}>
                {["Next.js", "Vite", "wagmi", "viem", "ethers.js", "Bridge", "Swap", "Earn / Yield"].map(f => (
                  <span key={f} style={{ fontFamily: mono, fontSize: 10, padding: "3px 9px", border: `1px solid ${S.border}`, color: S.muted }}>{f}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── ANALYSIS ── */}
        {step === "analysed" && analysis && (
          <div className="fade-up" style={{ border: `1px solid ${S.border}`, background: S.surface }}>
            <div style={{ padding: "12px 20px", borderBottom: `1px solid ${S.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontFamily: mono, fontSize: 11, color: S.accent, fontWeight: 700, letterSpacing: "0.08em" }}>✓ ANALYSIS COMPLETE</span>
              <span style={{ fontFamily: mono, fontSize: 10, color: S.muted }}>{new Date().toISOString().slice(0, 19).replace("T", " ")}</span>
            </div>
            <div style={{ padding: 20 }}>
              <p style={{ fontSize: 14, lineHeight: 1.65, color: "rgba(238,237,245,0.72)", borderLeft: `2px solid ${S.accent}`, paddingLeft: 14, marginBottom: 22 }}>{analysis.summary}</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: S.border, marginBottom: 1 }}>
                {[
                  { l: "stack", v: analysis.stack?.toUpperCase() || "—", c: S.text },
                  { l: "entry", v: analysis.entryFile || "detected", c: S.text },
                  { l: "packages", v: `${analysis.existingDeps?.length ?? 0} found`, c: S.text },
                  { l: "wagmi", v: analysis.hasWagmi ? "detected" : "—", c: analysis.hasWagmi ? S.accent : S.muted },
                  { l: "viem", v: analysis.hasViem ? "detected" : "—", c: analysis.hasViem ? S.accent : S.muted },
                  { l: "ethers", v: analysis.hasEthers ? "detected" : "—", c: analysis.hasEthers ? S.accent : S.muted },
                ].map(({ l, v, c }) => (
                  <div key={l} style={{ padding: "14px 16px", background: S.surface }}>
                    <div style={{ fontFamily: mono, fontSize: 10, color: S.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{l}</div>
                    <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: c }}>{v}</div>
                  </div>
                ))}
              </div>
              {analysis.chains?.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontFamily: mono, fontSize: 10, color: S.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>chains detected</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {analysis.chains.map(c => <span key={c} style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, padding: "4px 10px", border: `1px solid rgba(181,255,71,0.25)`, color: S.accent, background: S.accentDim }}>{c}</span>)}
                  </div>
                </div>
              )}
              {analysis.tokens?.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontFamily: mono, fontSize: 10, color: S.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>tokens detected</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {analysis.tokens.map(t => <span key={t} style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, padding: "4px 10px", border: `1px solid rgba(91,141,239,0.25)`, color: S.blue, background: S.blueDim }}>{t}</span>)}
                  </div>
                </div>
              )}
              {originalFiles.length > 0 && (
                <div style={{ marginTop: 14, padding: "10px 14px", border: `1px solid ${S.border}`, background: "rgba(0,0,0,0.2)" }}>
                  <span style={{ fontFamily: mono, fontSize: 10, color: S.muted, letterSpacing: "0.06em" }}>
                    {originalFiles.length} FILES FETCHED — full project will be returned in ZIP
                  </span>
                </div>
              )}
              {error && <div style={{ marginTop: 14, padding: "10px 14px", border: "1px solid rgba(255,80,80,0.2)", background: "rgba(255,80,80,0.05)", fontFamily: mono, fontSize: 12, color: "#ff6b6b" }}>✗ {error}</div>}
              <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                <button onClick={() => { setStep("input"); setAnalysis(null); setOriginalFiles([]); setError(""); }} style={{ padding: "12px 20px", background: "transparent", border: `1px solid ${S.border}`, color: S.muted, fontFamily: mono, fontSize: 11, letterSpacing: "0.05em", cursor: "pointer", transition: "all 0.2s" }}>← back</button>
                <button onClick={handleGenerate} disabled={loading} style={{ flex: 1, padding: "12px 0", background: S.accent, border: `1px solid ${S.accent}`, color: "#000", fontFamily: mono, fontSize: 12, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, transition: "all 0.2s" }}>
                  {loading ? `${loadingText}…` : "→ Generate LI.FI integration"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── GENERATED ── */}
        {step === "generated" && result && (
          <div className="fade-up">
            <div style={{ padding: "14px 20px", border: "1px solid rgba(181,255,71,0.28)", background: S.accentDim, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 1 }}>
              <div>
                <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: S.accent, letterSpacing: "0.07em" }}>✓ INTEGRATION READY</div>
                <div style={{ fontFamily: mono, fontSize: 10, color: "rgba(181,255,71,0.55)", marginTop: 3 }}>
                  {result.files.length} files total · {newFiles.length} new integration files · {originalProjectFiles.length} original project files
                </div>
              </div>
            </div>

            {/* New integration files */}
            {newFiles.length > 0 && (
              <>
                <div style={{ padding: "8px 16px", background: "rgba(181,255,71,0.04)", border: `1px solid ${S.border}`, borderBottom: "none", fontFamily: mono, fontSize: 10, color: S.accent, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  new integration files
                </div>
                {newFiles.map((f, fi) => (
                  <div key={f.filename} style={{ border: `1px solid ${S.border}`, borderTop: fi === 0 ? `1px solid ${S.border}` : "none", background: S.surface }}>
                    <div style={{ padding: "10px 16px", borderBottom: `1px solid ${S.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(0,0,0,0.2)" }}>
                      <code style={{ fontFamily: mono, fontSize: 11, color: S.accent }}>{f.filename}</code>
                      <button onClick={e => copyToClipboard(f.content, e.currentTarget)} style={{ padding: "3px 9px", background: "transparent", border: `1px solid ${S.border}`, color: S.muted, fontFamily: mono, fontSize: 10, cursor: "pointer", letterSpacing: "0.04em", transition: "all 0.2s" }}>copy</button>
                    </div>
                    <pre style={{ padding: 16, fontFamily: mono, fontSize: 11, color: "rgba(238,237,245,0.42)", maxHeight: 140, overflow: "auto", margin: 0, lineHeight: 1.7 }}>{f.content}</pre>
                  </div>
                ))}
              </>
            )}

            {/* Original files list */}
            {originalProjectFiles.length > 0 && (
              <div style={{ marginTop: 1 }}>
                <div style={{ padding: "8px 16px", background: "rgba(91,141,239,0.04)", border: `1px solid ${S.border}`, borderBottom: "none", fontFamily: mono, fontSize: 10, color: S.blue, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  original project files included in zip ({originalProjectFiles.length})
                </div>
                <div style={{ border: `1px solid ${S.border}`, background: S.surface, padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {originalProjectFiles.map(f => (
                    <span key={f.filename} style={{ fontFamily: mono, fontSize: 10, padding: "3px 8px", border: `1px solid rgba(91,141,239,0.2)`, color: S.blue, background: S.blueDim }}>{f.filename}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Install */}
            <div style={{ marginTop: 1, padding: "13px 18px", border: `1px solid ${S.border}`, background: S.surface, display: "flex", alignItems: "center", gap: 14, marginBottom: 1 }}>
              <span style={{ fontFamily: mono, fontSize: 10, color: S.muted, textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0 }}>run</span>
              <code style={{ fontFamily: mono, fontSize: 12, color: S.accent }}>{result.packageInstall}</code>
            </div>

            {/* Env vars */}
            {result.envVars?.length > 0 && (
              <div style={{ padding: "13px 18px", border: `1px solid ${S.border}`, borderTop: "none", background: S.surface, marginBottom: 16 }}>
                <div style={{ fontFamily: mono, fontSize: 10, color: S.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>.env</div>
                {result.envVars.map(v => (
                  <div key={v} style={{ fontFamily: mono, fontSize: 12, color: "rgba(238,237,245,0.55)" }}>{v}</div>
                ))}
              </div>
            )}

            <button onClick={handleDownload} style={{ width: "100%", padding: "16px 0", background: S.accent, border: "none", color: "#000", fontFamily: mono, fontSize: 13, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", marginBottom: 8, transition: "opacity 0.2s" }}>
              ↓ Download full project ZIP
            </button>

            <button onClick={() => { setStep("input"); setAnalysis(null); setResult(null); setOriginalFiles([]); setCode(""); setRepoUrl(""); setTypedLen(0); }} style={{ width: "100%", padding: "13px 0", background: "transparent", border: `1px solid ${S.border}`, color: S.muted, fontFamily: mono, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", transition: "all 0.2s" }}>
              ← start over
            </button>
          </div>
        )}
      </div>
    </main>
  );
}