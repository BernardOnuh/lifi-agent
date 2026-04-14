"use client";
import { useState, useEffect, useRef } from "react";

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

type GitHubRepo = { full_name: string; default_branch: string; private: boolean };

type PushStatus =
  | { type: "idle" }
  | { type: "pushing"; step: string }
  | { type: "success"; url: string }
  | { type: "error"; message: string };

const INTEGRATION_FILENAMES = new Set([
  "lib/lifi/config.ts",
  "hooks/useLiFiRoute.ts",
  "hooks/useLiFiSwap.ts",
  "LIFI_INTEGRATION.md",
]);

const CHAINS = ["Ethereum", "Polygon", "Arbitrum", "Optimism", "Base", "Avalanche", "BSC", "zkSync"];

// ─── GitHub helpers ────────────────────────────────────────────────────────────

async function ghFetch(path: string, token: string, opts: RequestInit = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? `GitHub ${res.status}`);
  }
  return res.json();
}

async function pushFilesToGitHub(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  files: GeneratedFile[],
  commitMessage: string,
  onStep: (s: string) => void
): Promise<string> {
  // 1. Get branch ref
  onStep("Fetching branch reference…");
  let refData: { object: { sha: string } };
  let parentSha: string;
  let baseTreeSha: string;

  try {
    refData = await ghFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token);
    parentSha = refData.object.sha;
    const commitData: { tree: { sha: string } } = await ghFetch(
      `/repos/${owner}/${repo}/git/commits/${parentSha}`,
      token
    );
    baseTreeSha = commitData.tree.sha;
  } catch {
    // Branch doesn't exist — create from default branch or empty
    onStep("Creating new branch…");
    try {
      const defaultRef: { object: { sha: string } } = await ghFetch(
        `/repos/${owner}/${repo}/git/refs/heads/main`,
        token
      );
      parentSha = defaultRef.object.sha;
      const commitData: { tree: { sha: string } } = await ghFetch(
        `/repos/${owner}/${repo}/git/commits/${parentSha}`,
        token
      );
      baseTreeSha = commitData.tree.sha;
    } catch {
      parentSha = "";
      baseTreeSha = "";
    }
  }

  // 2. Create blobs for each file
  onStep(`Creating blobs (${files.length} files)…`);
  const treeItems = await Promise.all(
    files.map(async (f) => {
      const blob: { sha: string } = await ghFetch(`/repos/${owner}/${repo}/git/blobs`, token, {
        method: "POST",
        body: JSON.stringify({ content: f.content, encoding: "utf-8" }),
      });
      return { path: f.filename, mode: "100644", type: "blob", sha: blob.sha };
    })
  );

  // 3. Create tree
  onStep("Building file tree…");
  const newTree: { sha: string } = await ghFetch(`/repos/${owner}/${repo}/git/trees`, token, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTreeSha || undefined,
      tree: treeItems,
    }),
  });

  // 4. Create commit
  onStep("Creating commit…");
  const newCommit: { sha: string } = await ghFetch(`/repos/${owner}/${repo}/git/commits`, token, {
    method: "POST",
    body: JSON.stringify({
      message: commitMessage,
      tree: newTree.sha,
      parents: parentSha ? [parentSha] : [],
    }),
  });

  // 5. Update or create ref
  onStep("Updating branch reference…");
  try {
    await ghFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token, {
      method: "PATCH",
      body: JSON.stringify({ sha: newCommit.sha }),
    });
  } catch {
    await ghFetch(`/repos/${owner}/${repo}/git/refs`, token, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: newCommit.sha }),
    });
  }

  return `https://github.com/${owner}/${repo}/tree/${branch}`;
}

// ─── GitHub Push Panel ─────────────────────────────────────────────────────────

function GitHubPushPanel({ files }: { files: GeneratedFile[] }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [branch, setBranch] = useState("lifi-integration");
  const [commitMsg, setCommitMsg] = useState("feat: add LI.FI cross-chain integration");
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [pushStatus, setPushStatus] = useState<PushStatus>({ type: "idle" });
  const [tokenError, setTokenError] = useState("");
  const [copiedUrl, setCopiedUrl] = useState(false);

  async function fetchRepos() {
    if (!token.trim()) { setTokenError("Enter a token first"); return; }
    setLoadingRepos(true);
    setTokenError("");
    try {
      const data: GitHubRepo[] = await ghFetch("/user/repos?per_page=100&sort=updated", token);
      setRepos(data);
      if (data.length) setSelectedRepo(data[0].full_name);
    } catch (e: unknown) {
      setTokenError(e instanceof Error ? e.message : "Invalid token");
    } finally {
      setLoadingRepos(false);
    }
  }

  async function handlePush() {
    if (!selectedRepo || !token) return;
    const [owner, repo] = selectedRepo.split("/");
    setPushStatus({ type: "pushing", step: "Starting…" });
    try {
      const url = await pushFilesToGitHub(
        token, owner, repo, branch.trim() || "lifi-integration",
        files, commitMsg.trim() || "feat: add LI.FI integration",
        (step) => setPushStatus({ type: "pushing", step })
      );
      setPushStatus({ type: "success", url });
    } catch (e: unknown) {
      setPushStatus({ type: "error", message: e instanceof Error ? e.message : "Push failed" });
    }
  }

  return (
    <div style={{ marginBottom: 8 }}>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          style={{
            width: "100%", height: 52, borderRadius: 8, display: "flex", alignItems: "center",
            justifyContent: "center", gap: 10, background: "transparent",
            border: "1px solid rgba(0,229,200,0.22)", color: "rgba(232,235,245,0.75)",
            fontFamily: "'Syne', system-ui, sans-serif", fontWeight: 700, fontSize: 13,
            letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer",
            transition: "all 0.2s",
          }}
          onMouseOver={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(0,229,200,0.5)";
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,229,200,0.05)";
          }}
          onMouseOut={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(0,229,200,0.22)";
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 2.5C5 2.5 2.5 5 2.5 8C2.5 10.4 4 12.4 6.1 13.2C6.4 13.3 6.5 13.1 6.5 12.9V12C4.8 12.3 4.4 11.2 4.4 11.2C4.1 10.5 3.6 10.3 3.6 10.3C3 9.9 3.6 9.9 3.6 9.9C4.2 9.9 4.6 10.5 4.6 10.5C5.2 11.5 6.2 11.2 6.5 11C6.6 10.6 6.8 10.3 7 10.2C5.3 10 3.5 9.3 3.5 6.5C3.5 5.7 3.8 5 4.3 4.5C4.2 4.3 3.9 3.5 4.4 2.4C4.4 2.4 5 2.2 6.5 3.2C7.2 3 7.9 2.9 8.6 2.9C9.3 2.9 10 3 10.7 3.2C12.2 2.2 12.8 2.4 12.8 2.4C13.3 3.5 13 4.3 12.9 4.5C13.4 5 13.7 5.7 13.7 6.5C13.7 9.3 11.9 10 10.2 10.2C10.5 10.4 10.7 10.9 10.7 11.6V13C10.7 13.2 10.8 13.3 11.1 13.2C13.2 12.4 14.7 10.4 14.7 8C14.5 5 12 2.5 8 2.5Z" fill="currentColor"/>
          </svg>
          Push to GitHub
        </button>
      ) : (
        <div style={{ border: "1px solid rgba(0,229,200,0.18)", borderRadius: 10, overflow: "hidden", background: "rgba(8,14,30,0.85)", backdropFilter: "blur(20px)" }}>
          {/* Panel header */}
          <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(0,229,200,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M8 2.5C5 2.5 2.5 5 2.5 8C2.5 10.4 4 12.4 6.1 13.2C6.4 13.3 6.5 13.1 6.5 12.9V12C4.8 12.3 4.4 11.2 4.4 11.2C4.1 10.5 3.6 10.3 3.6 10.3C3 9.9 3.6 9.9 3.6 9.9C4.2 9.9 4.6 10.5 4.6 10.5C5.2 11.5 6.2 11.2 6.5 11C6.6 10.6 6.8 10.3 7 10.2C5.3 10 3.5 9.3 3.5 6.5C3.5 5.7 3.8 5 4.3 4.5C4.2 4.3 3.9 3.5 4.4 2.4C4.4 2.4 5 2.2 6.5 3.2C7.2 3 7.9 2.9 8.6 2.9C9.3 2.9 10 3 10.7 3.2C12.2 2.2 12.8 2.4 12.8 2.4C13.3 3.5 13 4.3 12.9 4.5C13.4 5 13.7 5.7 13.7 6.5C13.7 9.3 11.9 10 10.2 10.2C10.5 10.4 10.7 10.9 10.7 11.6V13C10.7 13.2 10.8 13.3 11.1 13.2C13.2 12.4 14.7 10.4 14.7 8C14.5 5 12 2.5 8 2.5Z" fill="rgba(0,229,200,0.8)"/>
              </svg>
              <span style={{ fontFamily: "'Syne', system-ui, sans-serif", fontWeight: 700, fontSize: 13, color: "rgba(0,229,200,0.9)", letterSpacing: "0.04em" }}>Push to GitHub</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, padding: "2px 8px", border: "1px solid rgba(0,229,200,0.15)", borderRadius: 4, color: "rgba(0,229,200,0.5)" }}>{files.length} files</span>
            </div>
            <button onClick={() => { setOpen(false); setPushStatus({ type: "idle" }); }} style={{ background: "transparent", border: "none", cursor: "pointer", color: "rgba(232,235,245,0.3)", padding: 4, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          {/* Success state */}
          {pushStatus.type === "success" && (
            <div style={{ padding: 20 }}>
              <div style={{ padding: "16px 20px", border: "1px solid rgba(0,229,200,0.25)", background: "rgba(0,229,200,0.05)", borderRadius: 10, display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(0,229,200,0.12)", border: "1px solid rgba(0,229,200,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8L6.5 11.5L13 4" stroke="#00E5C8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#00E5C8", marginBottom: 4 }}>Pushed successfully</div>
                  <a href={pushStatus.url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "rgba(0,229,200,0.6)", textDecoration: "none", wordBreak: "break-all" }}>{pushStatus.url}</a>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <a href={pushStatus.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, height: 44, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "linear-gradient(135deg, #00E5C8, #00C8E5)", borderRadius: 8, fontFamily: "'Syne', system-ui, sans-serif", fontWeight: 700, fontSize: 13, color: "#04060F", textDecoration: "none", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2h5v5M6 8l6-6M2 12V3h4" stroke="#04060F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Open on GitHub
                </a>
                <button onClick={() => {
                  navigator.clipboard.writeText(pushStatus.type === "success" ? pushStatus.url : "");
                  setCopiedUrl(true);
                  setTimeout(() => setCopiedUrl(false), 1800);
                }} style={{ padding: "0 16px", height: 44, background: "transparent", border: "1px solid rgba(0,229,200,0.2)", color: "rgba(0,229,200,0.7)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, cursor: "pointer", borderRadius: 8, transition: "all 0.2s" }}>
                  {copiedUrl ? "✓ copied" : "copy url"}
                </button>
              </div>
            </div>
          )}

          {/* Pushing state */}
          {pushStatus.type === "pushing" && (
            <div style={{ padding: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
              <div style={{ position: "relative", width: 48, height: 48 }}>
                <div style={{ position: "absolute", inset: 0, border: "2px solid rgba(0,229,200,0.1)", borderRadius: "50%" }} />
                <div style={{ position: "absolute", inset: 0, border: "2px solid transparent", borderTopColor: "#00E5C8", borderRadius: "50%", animation: "spinnerRing 0.9s linear infinite" }} />
              </div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "rgba(0,229,200,0.7)", textAlign: "center" }}>{pushStatus.step}</div>
            </div>
          )}

          {/* Error state */}
          {pushStatus.type === "error" && (
            <div style={{ padding: 16 }}>
              <div style={{ padding: "12px 16px", border: "1px solid rgba(255,80,80,0.2)", background: "rgba(255,80,80,0.04)", borderRadius: 8, display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#FF5050", flexShrink: 0 }} />
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#FF8080" }}>{pushStatus.message}</span>
              </div>
              <button onClick={() => setPushStatus({ type: "idle" })} style={{ width: "100%", height: 40, background: "transparent", border: "1px solid rgba(0,229,200,0.18)", color: "rgba(232,235,245,0.55)", fontFamily: "'Syne', system-ui, sans-serif", fontWeight: 500, fontSize: 13, cursor: "pointer", borderRadius: 8, transition: "all 0.2s" }}>
                Try again
              </button>
            </div>
          )}

          {/* Idle / form state */}
          {pushStatus.type === "idle" && (
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>

              {/* PAT info */}
              <div style={{ padding: "10px 14px", background: "rgba(100,150,255,0.05)", border: "1px solid rgba(100,150,255,0.12)", borderRadius: 8, display: "flex", gap: 10 }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
                  <circle cx="7" cy="7" r="5.5" stroke="rgba(100,150,255,0.6)" strokeWidth="1"/>
                  <path d="M7 6v4M7 4.5v.5" stroke="rgba(100,150,255,0.6)" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "rgba(100,150,255,0.65)", lineHeight: 1.6 }}>
                  Needs a GitHub Personal Access Token with <strong style={{ color: "rgba(100,150,255,0.9)", fontWeight: 600 }}>repo</strong> scope.{" "}
                  <a href="https://github.com/settings/tokens/new?scopes=repo" target="_blank" rel="noopener noreferrer" style={{ color: "rgba(100,150,255,0.8)", textDecoration: "underline" }}>Create one →</a>
                </span>
              </div>

              {/* Token row */}
              <div>
                <label style={{ display: "block", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(232,235,245,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 7 }}>Personal Access Token</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="password"
                    value={token}
                    onChange={e => { setToken(e.target.value); setTokenError(""); }}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    style={{ flex: 1, height: 42, paddingLeft: 12, paddingRight: 12, background: "rgba(0,0,0,0.4)", border: `1px solid ${tokenError ? "rgba(255,80,80,0.4)" : "rgba(0,229,200,0.12)"}`, borderRadius: 7, color: "#E8EBF5", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, outline: "none" }}
                  />
                  <button
                    onClick={fetchRepos}
                    disabled={loadingRepos || !token.trim()}
                    style={{ padding: "0 16px", height: 42, background: repos.length ? "rgba(0,229,200,0.08)" : "transparent", border: `1px solid ${repos.length ? "rgba(0,229,200,0.3)" : "rgba(0,229,200,0.18)"}`, color: repos.length ? "#00E5C8" : "rgba(232,235,245,0.5)", fontFamily: "'Syne', system-ui, sans-serif", fontWeight: 600, fontSize: 12, cursor: "pointer", borderRadius: 7, whiteSpace: "nowrap", transition: "all 0.2s", opacity: loadingRepos || !token.trim() ? 0.5 : 1 }}
                  >
                    {loadingRepos ? "…" : repos.length ? `✓ ${repos.length} repos` : "Load Repos"}
                  </button>
                </div>
                {tokenError && <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#FF8080", marginTop: 6 }}>{tokenError}</div>}
              </div>

              {/* Repo selector */}
              <div style={{ opacity: repos.length ? 1 : 0.4, transition: "opacity 0.3s", pointerEvents: repos.length ? "auto" : "none" }}>
                <label style={{ display: "block", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(232,235,245,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 7 }}>Repository</label>
                <select
                  value={selectedRepo}
                  onChange={e => setSelectedRepo(e.target.value)}
                  style={{ width: "100%", height: 42, paddingLeft: 12, paddingRight: 12, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(0,229,200,0.12)", borderRadius: 7, color: selectedRepo ? "#E8EBF5" : "rgba(232,235,245,0.3)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, outline: "none", appearance: "none", cursor: "pointer" }}
                >
                  {repos.length === 0 && <option value="">— load repos first —</option>}
                  {repos.map(r => (
                    <option key={r.full_name} value={r.full_name} style={{ background: "#04060F" }}>
                      {r.private ? "🔒 " : ""}{r.full_name} ({r.default_branch})
                    </option>
                  ))}
                </select>
              </div>

              {/* Branch + commit message */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
                <div>
                  <label style={{ display: "block", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(232,235,245,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 7 }}>Branch</label>
                  <input
                    type="text"
                    value={branch}
                    onChange={e => setBranch(e.target.value)}
                    style={{ width: "100%", height: 42, paddingLeft: 12, paddingRight: 12, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(0,229,200,0.12)", borderRadius: 7, color: "#E8EBF5", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, outline: "none" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(232,235,245,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 7 }}>Commit message</label>
                  <input
                    type="text"
                    value={commitMsg}
                    onChange={e => setCommitMsg(e.target.value)}
                    style={{ width: "100%", height: 42, paddingLeft: 12, paddingRight: 12, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(0,229,200,0.12)", borderRadius: 7, color: "#E8EBF5", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, outline: "none" }}
                  />
                </div>
              </div>

              {/* File preview */}
              <div style={{ padding: "10px 14px", background: "rgba(0,0,0,0.2)", border: "1px solid rgba(0,229,200,0.07)", borderRadius: 7 }}>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(232,235,245,0.25)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Files to push ({files.length})</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {files.map(f => (
                    <span key={f.filename} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, padding: "3px 8px", border: `1px solid ${INTEGRATION_FILENAMES.has(f.filename) ? "rgba(0,229,200,0.2)" : "rgba(100,150,255,0.15)"}`, color: INTEGRATION_FILENAMES.has(f.filename) ? "rgba(0,229,200,0.6)" : "rgba(100,150,255,0.5)", borderRadius: 4 }}>
                      {f.filename}
                    </span>
                  ))}
                </div>
              </div>

              <button
                onClick={handlePush}
                disabled={!selectedRepo || !token.trim()}
                style={{
                  width: "100%", height: 50, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                  background: "linear-gradient(135deg, #00E5C8 0%, #00C8E5 100%)",
                  color: "#04060F", fontFamily: "'Syne', system-ui, sans-serif", fontWeight: 700, fontSize: 13,
                  letterSpacing: "0.06em", textTransform: "uppercase", border: "none", cursor: "pointer",
                  opacity: !selectedRepo || !token.trim() ? 0.45 : 1, transition: "all 0.2s",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 11V3M8 3L5 6M8 3L11 6" stroke="#04060F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M3 13H13" stroke="#04060F" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                Push {files.length} files to {selectedRepo ? selectedRepo.split("/")[1] : "repo"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [activeTab, setActiveTab] = useState<"paste" | "url">("url");
  const [code, setCode] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [originalFiles, setOriginalFiles] = useState<GeneratedFile[]>([]);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [loadingDots, setLoadingDots] = useState(0);
  const [step, setStep] = useState<"input" | "analysed" | "generated">("input");
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!analysing && !generating) return;
    const iv = setInterval(() => setLoadingDots(d => (d + 1) % 4), 380);
    return () => clearInterval(iv);
  }, [analysing, generating]);

  async function handleAnalyse() {
    setAnalysing(true);
    setError("");
    setLoadingText("Scanning dependencies");
    try {
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
      setAnalysing(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setError("");
    setLoadingText("Generating integration");
    try {
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
      setGenerating(false);
    }
  }

  async function handleDownload() {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    result?.files.forEach(f => {
      if ((f as GeneratedFile & { binary?: boolean }).binary) {
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

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    });
  }

  if (!mounted) return null;

  const hasInput = activeTab === "paste" ? code.trim().length > 0 : repoUrl.trim().length > 0;
  const newFiles = result?.files.filter(f => INTEGRATION_FILENAMES.has(f.filename)) ?? [];
  const originalProjectFiles = result?.files.filter(f => !INTEGRATION_FILENAMES.has(f.filename)) ?? [];
  const dots = ".".repeat(loadingDots);

  return (
    <main style={{ minHeight: "100vh", background: "#04060F", color: "#E8EBF5", fontFamily: "'Syne', system-ui, sans-serif", position: "relative", overflowX: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        ::selection { background: rgba(0,229,200,0.22); }
        textarea, input, select { outline: none; font-family: 'IBM Plex Mono', monospace; }
        textarea::-webkit-scrollbar { width: 4px; }
        textarea::-webkit-scrollbar-track { background: transparent; }
        textarea::-webkit-scrollbar-thumb { background: rgba(0,229,200,0.2); border-radius: 2px; }

        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes scanBeam { 0% { transform: translateY(-100%); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translateY(110vh); opacity: 0; } }
        @keyframes orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes orbitReverse { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.85); } }
        @keyframes pulseRing { 0% { transform: scale(0.8); opacity: 0.8; } 100% { transform: scale(2.2); opacity: 0; } }
        @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
        @keyframes tagPop { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
        @keyframes spinnerRing { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        .fade-up { animation: fadeSlideUp 0.5s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .fade-up-delay { animation: fadeSlideUp 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both; }
        .fade-up-delay2 { animation: fadeSlideUp 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.2s both; }

        .glass-panel { background: rgba(8,14,30,0.85); border: 1px solid rgba(0,229,200,0.12); backdrop-filter: blur(20px); }
        .glass-panel-blue { background: rgba(8,14,30,0.85); border: 1px solid rgba(100,150,255,0.12); backdrop-filter: blur(20px); }

        .btn-primary {
          background: linear-gradient(135deg, #00E5C8 0%, #00C8E5 100%);
          color: #04060F; font-family: 'Syne', system-ui, sans-serif; font-weight: 700;
          font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase;
          border: none; cursor: pointer; transition: all 0.2s; position: relative; overflow: hidden;
        }
        .btn-primary::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent); background-size: 200% 100%; animation: shimmer 2.5s infinite; }
        .btn-primary:hover { filter: brightness(1.1); transform: translateY(-1px); }
        .btn-primary:active { transform: translateY(0); filter: brightness(0.95); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; filter: none; }

        .btn-ghost { background: transparent; border: 1px solid rgba(0,229,200,0.18); color: rgba(232,235,245,0.55); font-family: 'Syne', system-ui, sans-serif; font-weight: 500; font-size: 13px; cursor: pointer; transition: all 0.2s; }
        .btn-ghost:hover { border-color: rgba(0,229,200,0.4); color: rgba(232,235,245,0.85); background: rgba(0,229,200,0.05); }

        .input-field { background: rgba(0,0,0,0.4); border: 1px solid rgba(0,229,200,0.12); color: #E8EBF5; font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; transition: border-color 0.2s, box-shadow 0.2s; width: 100%; }
        .input-field:focus { border-color: rgba(0,229,200,0.45); box-shadow: 0 0 0 3px rgba(0,229,200,0.07), inset 0 0 20px rgba(0,229,200,0.03); }
        .input-field::placeholder { color: rgba(232,235,245,0.2); }

        .chain-tag { animation: tagPop 0.3s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .chain-tag:nth-child(1) { animation-delay: 0.05s; }
        .chain-tag:nth-child(2) { animation-delay: 0.1s; }
        .chain-tag:nth-child(3) { animation-delay: 0.15s; }
        .chain-tag:nth-child(4) { animation-delay: 0.2s; }
        .chain-tag:nth-child(5) { animation-delay: 0.25s; }

        .file-row:hover { background: rgba(0,229,200,0.04); }
        .file-row { transition: background 0.15s; }

        .stat-card { background: rgba(0,0,0,0.3); border: 1px solid rgba(0,229,200,0.08); padding: 14px 16px; border-radius: 8px; transition: border-color 0.2s; }
        .stat-card:hover { border-color: rgba(0,229,200,0.2); }

        .step-connector { height: 2px; flex: 1; background: rgba(0,229,200,0.08); position: relative; overflow: hidden; }
        .step-connector.active { background: rgba(0,229,200,0.15); }
        .step-connector.active::after { content: ''; position: absolute; top: 0; left: 0; height: 100%; width: 40%; background: linear-gradient(90deg, transparent, rgba(0,229,200,0.7), transparent); animation: shimmer 1.8s infinite; }
      `}</style>

      {/* Background grid */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, backgroundImage: `linear-gradient(rgba(0,229,200,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,200,0.025) 1px, transparent 1px)`, backgroundSize: "48px 48px" }} />
      <div style={{ position: "fixed", top: "20%", left: "50%", transform: "translateX(-50%)", width: 800, height: 400, background: "radial-gradient(ellipse, rgba(0,100,200,0.06) 0%, transparent 65%)", pointerEvents: "none", zIndex: 0 }} />
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent 0%, rgba(0,229,200,0.4) 50%, transparent 100%)", animation: "scanBeam 12s ease-in-out infinite", pointerEvents: "none", zIndex: 1 }} />

      {/* HEADER */}
      <header style={{ position: "sticky", top: 0, zIndex: 200, height: 56, borderBottom: "1px solid rgba(0,229,200,0.1)", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", backdropFilter: "blur(24px)", background: "rgba(4,6,15,0.92)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ position: "relative", width: 30, height: 30 }}>
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, #00E5C8, #0088FF)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L14 5.5V10.5L8 14L2 10.5V5.5L8 2Z" stroke="#04060F" strokeWidth="1.5" fill="none"/><circle cx="8" cy="8" r="2" fill="#04060F"/></svg>
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-0.01em", lineHeight: 1 }}>LI.FI Agent</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(0,229,200,0.6)", letterSpacing: "0.12em", marginTop: 2 }}>v2.0</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {CHAINS.slice(0, 5).map((c, i) => (
              <div key={c} title={c} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, padding: "3px 7px", border: "1px solid rgba(0,229,200,0.1)", color: "rgba(232,235,245,0.35)", borderRadius: 4, letterSpacing: "0.04em", animationDelay: `${i * 0.3}s` }}>{c.slice(0, 3).toUpperCase()}</div>
            ))}
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(232,235,245,0.25)" }}>+{CHAINS.length - 5}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ position: "relative", width: 8, height: 8 }}>
              <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#00E5C8", animation: "pulse 2s ease-in-out infinite" }} />
              <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "1px solid rgba(0,229,200,0.5)", animation: "pulseRing 2s ease-out infinite" }} />
            </div>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "rgba(0,229,200,0.8)", letterSpacing: "0.1em" }}>LIVE</span>
          </div>
        </div>
      </header>

      {/* MAIN */}
      <div style={{ position: "relative", zIndex: 10, maxWidth: 760, margin: "0 auto", padding: "40px 20px 100px" }}>

        {step === "input" && (
          <div className="fade-up" style={{ paddingBottom: 48, textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 32 }}>
              <div style={{ position: "relative", width: 90, height: 90 }}>
                <svg width="90" height="90" viewBox="0 0 90 90" style={{ position: "absolute", inset: 0, animation: "orbit 12s linear infinite" }}>
                  <circle cx="45" cy="45" r="38" fill="none" stroke="rgba(0,229,200,0.12)" strokeWidth="1" strokeDasharray="4 8"/>
                  <circle cx="45" cy="7" r="3.5" fill="#00E5C8" style={{ filter: "drop-shadow(0 0 5px rgba(0,229,200,0.8))" }}/>
                </svg>
                <svg width="90" height="90" viewBox="0 0 90 90" style={{ position: "absolute", inset: 0, animation: "orbitReverse 8s linear infinite" }}>
                  <ellipse cx="45" cy="45" rx="26" ry="12" fill="none" stroke="rgba(100,150,255,0.15)" strokeWidth="1" strokeDasharray="3 6" transform="rotate(-20 45 45)"/>
                  <circle cx="71" cy="45" r="2.5" fill="#6496FF" style={{ filter: "drop-shadow(0 0 4px rgba(100,150,255,0.8))", transform: "rotate(-20deg)", transformOrigin: "45px 45px" }}/>
                </svg>
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ width: 28, height: 28, background: "linear-gradient(135deg, #00E5C8, #0088FF)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 20px rgba(0,229,200,0.35)" }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1L13 4.5V9.5L7 13L1 9.5V4.5L7 1Z" stroke="#04060F" strokeWidth="1.5"/><circle cx="7" cy="7" r="2" fill="#04060F"/></svg>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 14px", border: "1px solid rgba(0,229,200,0.2)", borderRadius: 100, marginBottom: 20, background: "rgba(0,229,200,0.05)" }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#00E5C8", animation: "pulse 2s infinite" }} />
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "rgba(0,229,200,0.8)", letterSpacing: "0.08em" }}>CROSS-CHAIN INTEGRATION AGENT</span>
            </div>
            <h1 style={{ fontSize: "clamp(28px, 5vw, 48px)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.08, marginBottom: 16 }}>
              Integrate LI.FI into{" "}
              <span style={{ background: "linear-gradient(135deg, #00E5C8, #6496FF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>any project</span>
            </h1>
            <p style={{ fontSize: 15, color: "rgba(232,235,245,0.45)", maxWidth: 440, margin: "0 auto", lineHeight: 1.8 }}>
              Drop a GitHub URL or paste your code. The agent reads your project structure and returns it with LI.FI fully integrated.
            </p>
          </div>
        )}

        {/* STEP PROGRESS */}
        <div className="fade-up" style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 32 }}>
          {[{ id: "input", n: "01", label: "Share Project" }, { id: "analysed", n: "02", label: "Analysis" }, { id: "generated", n: "03", label: "Integration" }].map((s, i, arr) => {
            const steps = ["input", "analysed", "generated"];
            const curIdx = steps.indexOf(step);
            const sIdx = steps.indexOf(s.id);
            const done = sIdx < curIdx;
            const active = sIdx === curIdx;
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", flex: i < arr.length - 1 ? 1 : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: done ? "linear-gradient(135deg, #00E5C8, #0088FF)" : active ? "rgba(0,229,200,0.12)" : "rgba(255,255,255,0.04)", border: done ? "none" : `1px solid ${active ? "rgba(0,229,200,0.4)" : "rgba(255,255,255,0.08)"}`, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, color: done ? "#04060F" : active ? "#00E5C8" : "rgba(232,235,245,0.25)", transition: "all 0.4s", boxShadow: active ? "0 0 12px rgba(0,229,200,0.25)" : "none" }}>
                    {done ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#04060F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg> : s.n}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: "rgba(232,235,245,0.25)", letterSpacing: "0.1em", textTransform: "uppercase", lineHeight: 1 }}>Step {s.n}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: active ? "#E8EBF5" : done ? "rgba(0,229,200,0.7)" : "rgba(232,235,245,0.3)", marginTop: 2, transition: "color 0.3s" }}>{s.label}</span>
                  </div>
                </div>
                {i < arr.length - 1 && <div className={`step-connector ${done ? "active" : ""}`} style={{ margin: "0 12px" }} />}
              </div>
            );
          })}
        </div>

        {/* STEP 1 */}
        {step === "input" && (
          <div className="fade-up glass-panel" style={{ borderRadius: 12, overflow: "hidden" }}>
            <div style={{ display: "flex", borderBottom: "1px solid rgba(0,229,200,0.08)", background: "rgba(0,0,0,0.2)" }}>
              {([["url", "GitHub URL"], ["paste", "Paste Code"]] as const).map(([tab, label]) => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: "14px 20px", background: "transparent", border: "none", borderBottom: `2px solid ${activeTab === tab ? "#00E5C8" : "transparent"}`, fontFamily: "'Syne', system-ui, sans-serif", fontSize: 13, fontWeight: activeTab === tab ? 700 : 500, color: activeTab === tab ? "#E8EBF5" : "rgba(232,235,245,0.35)", cursor: "pointer", transition: "all 0.2s", marginBottom: -1, display: "flex", alignItems: "center", gap: 8 }}>
                  {tab === "url" ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ opacity: activeTab === tab ? 1 : 0.4 }}><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/><path d="M2 7h10M7 1.5c-1.5 1.5-2.5 3.2-2.5 5.5s1 4 2.5 5.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg> : <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ opacity: activeTab === tab ? 1 : 0.4 }}><rect x="2" y="1" width="8" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M5 1V3H9V1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><path d="M4.5 6H9.5M4.5 8H7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6"/></svg>}
                  {label}
                </button>
              ))}
            </div>
            <div style={{ padding: 20 }}>
              {activeTab === "url" ? (
                <div style={{ position: "relative" }}>
                  <div style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" opacity="0.4"><path d="M8 2.5C5 2.5 2.5 5 2.5 8C2.5 10.4 4 12.4 6.1 13.2C6.4 13.3 6.5 13.1 6.5 12.9V12C4.8 12.3 4.4 11.2 4.4 11.2C4.1 10.5 3.6 10.3 3.6 10.3C3 9.9 3.6 9.9 3.6 9.9C4.2 9.9 4.6 10.5 4.6 10.5C5.2 11.5 6.2 11.2 6.5 11C6.6 10.6 6.8 10.3 7 10.2C5.3 10 3.5 9.3 3.5 6.5C3.5 5.7 3.8 5 4.3 4.5C4.2 4.3 3.9 3.5 4.4 2.4C4.4 2.4 5 2.2 6.5 3.2C7.2 3 7.9 2.9 8.6 2.9C9.3 2.9 10 3 10.7 3.2C12.2 2.2 12.8 2.4 12.8 2.4C13.3 3.5 13 4.3 12.9 4.5C13.4 5 13.7 5.7 13.7 6.5C13.7 9.3 11.9 10 10.2 10.2C10.5 10.4 10.7 10.9 10.7 11.6V13C10.7 13.2 10.8 13.3 11.1 13.2C13.2 12.4 14.7 10.4 14.7 8C14.5 5 12 2.5 8 2.5Z" fill="currentColor"/></svg>
                  </div>
                  <input type="text" value={repoUrl} onChange={e => setRepoUrl(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && hasInput && !analysing) handleAnalyse(); }} placeholder="https://github.com/username/repository" className="input-field" style={{ paddingLeft: 40, paddingRight: 14, height: 48, borderRadius: 8 }} autoFocus />
                </div>
              ) : (
                <div style={{ position: "relative" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 38, display: "flex", flexDirection: "column", padding: "12px 0", alignItems: "flex-end", paddingRight: 8, pointerEvents: "none", userSelect: "none", borderRight: "1px solid rgba(0,229,200,0.06)", background: "rgba(0,0,0,0.2)" }}>
                    {Array.from({ length: 13 }, (_, i) => <div key={i} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, lineHeight: "1.72em", color: "rgba(232,235,245,0.12)" }}>{i + 1}</div>)}
                  </div>
                  <textarea ref={textareaRef} value={code} onChange={e => setCode(e.target.value)} rows={13} placeholder={"// Paste your package.json, hooks, components...\n// The agent reads your project structure\n// and generates perfectly typed integration files."} className="input-field" style={{ paddingLeft: 50, paddingTop: 12, paddingBottom: 12, paddingRight: 14, resize: "none", lineHeight: 1.72, borderRadius: 8 }} />
                  {code && <div style={{ position: "absolute", top: 10, right: 10, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(0,229,200,0.4)", padding: "2px 8px", border: "1px solid rgba(0,229,200,0.1)", borderRadius: 4, background: "rgba(0,0,0,0.4)" }}>{code.split("\n").length} lines</div>}
                </div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 14 }}>
                {["Next.js", "Vite", "wagmi", "viem", "ethers.js", "Bridge", "Swap", "Earn / Yield"].map((tag, i) => (
                  <span key={tag} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, padding: "4px 10px", border: "1px solid rgba(0,229,200,0.1)", color: "rgba(232,235,245,0.3)", borderRadius: 4, letterSpacing: "0.04em", animationDelay: `${i * 0.04}s` }}>{tag}</span>
                ))}
              </div>
              {error && <div style={{ marginTop: 14, padding: "12px 16px", border: "1px solid rgba(255,80,80,0.2)", background: "rgba(255,80,80,0.04)", borderRadius: 8, display: "flex", alignItems: "center", gap: 10 }}><div style={{ width: 6, height: 6, borderRadius: "50%", background: "#FF5050", flexShrink: 0 }} /><span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#FF8080" }}>{error}</span></div>}
              <button onClick={handleAnalyse} disabled={analysing || !hasInput} className="btn-primary" style={{ marginTop: 16, width: "100%", height: 52, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 13 }}>
                {analysing ? (<><div style={{ width: 16, height: 16, border: "2px solid rgba(4,6,15,0.3)", borderTop: "2px solid #04060F", borderRadius: "50%", animation: "spinnerRing 0.8s linear infinite", flexShrink: 0 }} /><span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{loadingText}{dots}</span></>) : (<><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="#04060F" strokeWidth="1.5"/><path d="M10.5 10.5L14 14" stroke="#04060F" strokeWidth="1.5" strokeLinecap="round"/><path d="M5 7H9M7 5V9" stroke="#04060F" strokeWidth="1.2" strokeLinecap="round"/></svg>Analyse Project</>)}
              </button>
            </div>
          </div>
        )}

        {/* STEP 2 */}
        {step === "analysed" && analysis && (
          <div className="fade-up">
            <div style={{ padding: "14px 20px", border: "1px solid rgba(0,229,200,0.2)", background: "rgba(0,229,200,0.05)", borderRadius: 10, marginBottom: 12, display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(0,229,200,0.12)", border: "1px solid rgba(0,229,200,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7L6 10.5L11.5 3.5" stroke="#00E5C8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#00E5C8", letterSpacing: "0.04em" }}>Analysis Complete</div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "rgba(232,235,245,0.35)", marginTop: 2 }}>{new Date().toISOString().slice(0, 19).replace("T", " ")} UTC</div>
              </div>
            </div>
            <div className="glass-panel" style={{ borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(0,229,200,0.08)" }}>
                <p style={{ fontSize: 14, lineHeight: 1.75, color: "rgba(232,235,245,0.65)", borderLeft: "2px solid rgba(0,229,200,0.4)", paddingLeft: 14 }}>{analysis.summary}</p>
              </div>
              <div style={{ padding: 20 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 20 }}>
                  {[{ label: "Stack", value: analysis.stack?.toUpperCase() || "—", highlight: false }, { label: "Entry File", value: analysis.entryFile || "detected", highlight: false }, { label: "Packages", value: `${analysis.existingDeps?.length ?? 0} found`, highlight: false }, { label: "wagmi", value: analysis.hasWagmi ? "✓ detected" : "—", highlight: analysis.hasWagmi }, { label: "viem", value: analysis.hasViem ? "✓ detected" : "—", highlight: analysis.hasViem }, { label: "ethers.js", value: analysis.hasEthers ? "✓ detected" : "—", highlight: analysis.hasEthers }].map(({ label, value, highlight }) => (
                    <div key={label} className="stat-card"><div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(232,235,245,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div><div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 600, color: highlight ? "#00E5C8" : "rgba(232,235,245,0.85)" }}>{value}</div></div>
                  ))}
                </div>
                {analysis.chains?.length > 0 && <div style={{ marginBottom: 16 }}><div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(232,235,245,0.3)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 10 }}>Chains Detected</div><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{analysis.chains.map((c, i) => <span key={c} className="chain-tag" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, padding: "5px 11px", border: "1px solid rgba(0,229,200,0.2)", color: "#00E5C8", background: "rgba(0,229,200,0.06)", borderRadius: 6, animationDelay: `${i * 0.06}s` }}>{c}</span>)}</div></div>}
                {analysis.tokens?.length > 0 && <div style={{ marginBottom: 16 }}><div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(232,235,245,0.3)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 10 }}>Tokens Detected</div><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{analysis.tokens.map((t, i) => <span key={t} className="chain-tag" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, padding: "5px 11px", border: "1px solid rgba(100,150,255,0.2)", color: "#6496FF", background: "rgba(100,150,255,0.06)", borderRadius: 6, animationDelay: `${i * 0.06}s` }}>{t}</span>)}</div></div>}
                {originalFiles.length > 0 && <div style={{ padding: "10px 14px", border: "1px solid rgba(0,229,200,0.08)", borderRadius: 6, background: "rgba(0,0,0,0.2)", display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}><svg width="14" height="14" viewBox="0 0 14 14" fill="none" opacity="0.5"><path d="M2 2h5l2 2h3v8H2V2z" stroke="rgba(0,229,200,0.6)" strokeWidth="1.2" fill="none" strokeLinejoin="round"/></svg><span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "rgba(232,235,245,0.4)" }}>{originalFiles.length} files fetched — full project returned in ZIP</span></div>}
                {error && <div style={{ marginBottom: 16, padding: "12px 16px", border: "1px solid rgba(255,80,80,0.2)", background: "rgba(255,80,80,0.04)", borderRadius: 8, display: "flex", alignItems: "center", gap: 10 }}><div style={{ width: 6, height: 6, borderRadius: "50%", background: "#FF5050", flexShrink: 0 }} /><span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#FF8080" }}>{error}</span></div>}
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => { setStep("input"); setAnalysis(null); setOriginalFiles([]); setError(""); }} className="btn-ghost" style={{ padding: "13px 20px", borderRadius: 8, display: "flex", alignItems: "center", gap: 6 }}><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8 2L4 6L8 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>Back</button>
                  <button onClick={handleGenerate} disabled={generating} className="btn-primary" style={{ flex: 1, height: 50, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                    {generating ? (<><div style={{ width: 16, height: 16, border: "2px solid rgba(4,6,15,0.3)", borderTop: "2px solid #04060F", borderRadius: "50%", animation: "spinnerRing 0.8s linear infinite", flexShrink: 0 }} /><span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{loadingText}{dots}</span></>) : (<><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8L7 12L13 4" stroke="#04060F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>Generate LI.FI Integration</>)}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3 */}
        {step === "generated" && result && (
          <div className="fade-up">
            <div style={{ padding: "16px 20px", border: "1px solid rgba(0,229,200,0.25)", background: "linear-gradient(135deg, rgba(0,229,200,0.06), rgba(0,136,255,0.04))", borderRadius: 10, marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(0,229,200,0.12)", border: "1px solid rgba(0,229,200,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 9L7.5 13.5L15 4.5" stroke="#00E5C8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#00E5C8" }}>Integration Ready</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "rgba(232,235,245,0.35)", marginTop: 2 }}>{result.files.length} total files · {newFiles.length} new · {originalProjectFiles.length} original</div>
                </div>
              </div>
            </div>

            {newFiles.length > 0 && (
              <div className="glass-panel" style={{ borderRadius: 10, overflow: "hidden", marginBottom: 10 }}>
                <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(0,229,200,0.08)", display: "flex", alignItems: "center", gap: 8, background: "rgba(0,229,200,0.03)" }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00E5C8" }} />
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "rgba(0,229,200,0.7)", letterSpacing: "0.07em", textTransform: "uppercase" }}>New Integration Files</span>
                </div>
                {newFiles.map((f, fi) => (
                  <div key={f.filename}>
                    <div className="file-row" onClick={() => setExpandedFile(expandedFile === f.filename ? null : f.filename)} style={{ padding: "12px 16px", borderTop: fi > 0 ? "1px solid rgba(0,229,200,0.06)" : undefined, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" opacity="0.5"><path d="M2.5 2h5l2 2h2v8h-9V2z" stroke="#00E5C8" strokeWidth="1" fill="rgba(0,229,200,0.06)" strokeLinejoin="round"/></svg>
                        <code style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#00E5C8" }}>{f.filename}</code>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button onClick={e => { e.stopPropagation(); copyText(f.content, f.filename); }} style={{ padding: "4px 10px", background: copiedKey === f.filename ? "rgba(0,229,200,0.12)" : "transparent", border: `1px solid ${copiedKey === f.filename ? "rgba(0,229,200,0.4)" : "rgba(0,229,200,0.15)"}`, color: copiedKey === f.filename ? "#00E5C8" : "rgba(232,235,245,0.35)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, cursor: "pointer", borderRadius: 5, transition: "all 0.2s", letterSpacing: "0.04em" }}>{copiedKey === f.filename ? "✓ copied" : "copy"}</button>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: "rgba(232,235,245,0.2)", transition: "transform 0.2s", transform: expandedFile === f.filename ? "rotate(180deg)" : "rotate(0)" }}><path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      </div>
                    </div>
                    {expandedFile === f.filename && (
                      <div style={{ borderTop: "1px solid rgba(0,229,200,0.06)" }}>
                        <pre style={{ padding: "14px 16px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: "rgba(232,235,245,0.5)", maxHeight: 200, overflow: "auto", margin: 0, lineHeight: 1.75, background: "rgba(0,0,0,0.25)" }}>{f.content}</pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {originalProjectFiles.length > 0 && (
              <div className="glass-panel-blue" style={{ borderRadius: 10, overflow: "hidden", marginBottom: 10 }}>
                <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(100,150,255,0.08)", display: "flex", alignItems: "center", gap: 8, background: "rgba(100,150,255,0.03)" }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#6496FF" }} />
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "rgba(100,150,255,0.7)", letterSpacing: "0.07em", textTransform: "uppercase" }}>Original Project Files ({originalProjectFiles.length})</span>
                </div>
                <div style={{ padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {originalProjectFiles.map(f => <span key={f.filename} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, padding: "4px 9px", border: "1px solid rgba(100,150,255,0.15)", color: "rgba(100,150,255,0.6)", background: "rgba(100,150,255,0.05)", borderRadius: 5 }}>{f.filename}</span>)}
                </div>
              </div>
            )}

            <div style={{ padding: "14px 18px", border: "1px solid rgba(0,229,200,0.1)", background: "rgba(0,0,0,0.35)", borderRadius: 8, marginBottom: 8, display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00E5C8", opacity: 0.6 }} />
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(232,235,245,0.3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>run</span>
              </div>
              <code style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: "#E8EBF5", flex: 1 }}>{result.packageInstall}</code>
              <button onClick={() => copyText(result.packageInstall, "install")} style={{ padding: "4px 10px", background: copiedKey === "install" ? "rgba(0,229,200,0.12)" : "transparent", border: `1px solid ${copiedKey === "install" ? "rgba(0,229,200,0.4)" : "rgba(0,229,200,0.12)"}`, color: copiedKey === "install" ? "#00E5C8" : "rgba(232,235,245,0.3)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, cursor: "pointer", borderRadius: 5, transition: "all 0.2s", flexShrink: 0 }}>{copiedKey === "install" ? "✓" : "copy"}</button>
            </div>

            {result.envVars?.length > 0 && (
              <div style={{ padding: "14px 18px", border: "1px solid rgba(0,229,200,0.08)", background: "rgba(0,0,0,0.25)", borderRadius: 8, marginBottom: 16 }}>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(232,235,245,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>.env</div>
                {result.envVars.map(v => <div key={v} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: "rgba(232,235,245,0.5)", lineHeight: 2 }}>{v}</div>)}
              </div>
            )}

            {/* ── GitHub Push Panel ── */}
            <GitHubPushPanel files={result.files} />

            {/* Download ZIP */}
            <button onClick={handleDownload} className="btn-primary" style={{ width: "100%", height: 56, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, fontSize: 14, marginBottom: 8 }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 3V12M9 12L5.5 8.5M9 12L12.5 8.5" stroke="#04060F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 15H15" stroke="#04060F" strokeWidth="2" strokeLinecap="round"/></svg>
              Download Full Project ZIP
            </button>

            <button onClick={() => { setStep("input"); setAnalysis(null); setResult(null); setOriginalFiles([]); setCode(""); setRepoUrl(""); }} className="btn-ghost" style={{ width: "100%", height: 46, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8 2L4 6L8 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              Start Over
            </button>
          </div>
        )}
      </div>
    </main>
  );
}