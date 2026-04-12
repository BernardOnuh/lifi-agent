import { NextRequest, NextResponse } from "next/server";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

type RawFile = { filename: string; content: string };

function isGitHubUrl(input: string): boolean {
  return input.trim().startsWith("https://github.com/");
}

async function fetchGitHubFiles(url: string): Promise<RawFile[]> {
  const match = url.match(/github\.com\/([^/]+)\/([^/\s]+)/);
  if (!match) throw new Error("Invalid GitHub URL format.");

  const owner = match[1];
  const repo = match[2].replace(/\.git$/, "").trim();

  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
    { headers: { Accept: "application/vnd.github.v3+json" } }
  );

  if (!treeRes.ok) {
    throw new Error(
      `Could not fetch repo "${owner}/${repo}". Make sure it is a public repository.`
    );
  }

  const tree = await treeRes.json();

  const relevant: { path: string }[] = (tree.tree ?? [])
    .filter(
      (f: { type: string; path: string }) =>
        f.type === "blob" &&
        /\.(ts|tsx|js|jsx|json)$/.test(f.path) &&
        !f.path.includes("node_modules/") &&
        !f.path.includes(".next/") &&
        !f.path.includes("dist/") &&
        !f.path.includes(".git/") &&
        !f.path.endsWith(".lock") &&
        !f.path.endsWith("-lock.json")
    )
    .slice(0, 40);

  const files = await Promise.all(
    relevant.map(async (f) => {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${f.path}`,
          { headers: { Accept: "application/vnd.github.v3+json" } }
        );
        if (!res.ok) return null;
        const data = await res.json();
        const content = Buffer.from(data.content ?? "", "base64").toString("utf-8");
        return { filename: f.path, content };
      } catch {
        return null;
      }
    })
  );

  return files.filter(Boolean) as RawFile[];
}

export async function POST(req: NextRequest) {
  try {
    const { code } = await req.json();

    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "No code provided" }, { status: 400 });
    }

    let originalFiles: RawFile[] = [];
    let codeForAnalysis = "";

    if (isGitHubUrl(code)) {
      originalFiles = await fetchGitHubFiles(code);
      codeForAnalysis = originalFiles
        .map((f) => `// FILE: ${f.filename}\n${f.content}`)
        .join("\n\n")
        .slice(0, 14000);
    } else {
      originalFiles = [{ filename: "pasted-code.ts", content: code }];
      codeForAnalysis = code.slice(0, 14000);
    }

    const prompt = `You are an expert Web3 developer agent. Analyse the following project code and extract structured information.

PROJECT CODE:
${codeForAnalysis}

Return ONLY a valid JSON object with this exact shape — no markdown, no explanation, just raw JSON:
{
  "stack": "nextjs" | "vite" | "nodejs" | "unknown",
  "hasWagmi": boolean,
  "hasEthers": boolean,
  "hasViem": boolean,
  "chains": string[],
  "tokens": string[],
  "existingDeps": string[],
  "entryFile": string,
  "summary": string
}

Rules:
- stack: detect from imports, config files, or package.json.
- hasWagmi: true if wagmi appears in any file.
- hasEthers: true if ethers appears in any file.
- hasViem: true if viem appears in any file.
- chains: blockchain networks mentioned, lowercase. Empty array if none.
- tokens: token symbols mentioned, uppercase. Empty array if none.
- existingDeps: all npm packages from imports or package.json.
- entryFile: best guess at the main entry file path.
- summary: one sentence describing the project and what LI.FI integration makes sense.`;

    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Groq error: ${err}`);
    }

    const groqData = await response.json();
    const raw = groqData.choices?.[0]?.message?.content ?? "";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const analysis = JSON.parse(cleaned);

    return NextResponse.json({ analysis, originalFiles });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to analyse project";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}