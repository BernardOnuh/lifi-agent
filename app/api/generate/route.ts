import { NextRequest, NextResponse } from "next/server";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

type RawFile = { filename: string; content: string };

export async function POST(req: NextRequest) {
  try {
    const { analysis, originalFiles } = await req.json();

    if (!analysis) {
      return NextResponse.json({ error: "No analysis provided" }, { status: 400 });
    }

    const { stack, hasWagmi, hasViem, hasEthers, chains, tokens, existingDeps, entryFile } =
      analysis;

    // Build context from original files (capped to avoid token overflow)
    const originalContext = (originalFiles as RawFile[] ?? [])
      .map((f) => `// FILE: ${f.filename}\n${f.content.slice(0, 800)}`)
      .join("\n\n")
      .slice(0, 10000);

    // Find existing package.json if present
    const pkgFile = (originalFiles as RawFile[] ?? []).find(
      (f) => f.filename === "package.json"
    );

    const prompt = `You are an expert Web3 developer agent specialising in LI.FI SDK integration.

Your job is to inject a complete LI.FI integration into an existing project and return ALL project files — both the originals (modified where needed) and the new integration files.

PROJECT DETAILS:
- Stack: ${stack}
- Entry file: ${entryFile}
- Has wagmi: ${hasWagmi}
- Has viem: ${hasViem}
- Has ethers.js: ${hasEthers}
- Chains: ${chains?.join(", ") || "ethereum, polygon"}
- Tokens: ${tokens?.join(", ") || "USDC, ETH"}
- Existing deps: ${existingDeps?.join(", ") || "none"}

ORIGINAL PROJECT FILES (truncated for context):
${originalContext}

${pkgFile ? `CURRENT package.json:\n${pkgFile.content}` : ""}

INSTRUCTIONS:
1. Generate these NEW integration files with full content:
   - lib/lifi/config.ts — LI.FI SDK config using createConfig() with detected chains
   - hooks/useLiFiRoute.ts — hook using getRoutes() from @lifi/sdk
   - hooks/useLiFiSwap.ts — hook using executeRoute() from @lifi/sdk
   - LIFI_INTEGRATION.md — setup instructions for the developer

2. Generate a MODIFIED package.json that adds "@lifi/sdk" and "@lifi/wallet-management" to dependencies.

3. If the entry file (${entryFile}) exists in the project, generate a MODIFIED version of it that imports and initialises the LI.FI config at the top level.

4. Use wagmi/viem patterns if hasWagmi is true. Use ethers patterns if hasEthers is true and hasWagmi is false.

5. All new files must be TypeScript with proper types and JSDoc comments.

Return ONLY a valid JSON object — no markdown fences, no explanation, just raw JSON:
{
  "files": [
    { "filename": "lib/lifi/config.ts", "content": "full file content here" },
    { "filename": "hooks/useLiFiRoute.ts", "content": "full file content here" },
    { "filename": "hooks/useLiFiSwap.ts", "content": "full file content here" },
    { "filename": "LIFI_INTEGRATION.md", "content": "full file content here" },
    { "filename": "package.json", "content": "full modified package.json here" }
  ],
  "packageInstall": "npm install @lifi/sdk @lifi/wallet-management",
  "envVars": ["NEXT_PUBLIC_LIFI_INTEGRATOR=my-app"]
}

IMPORTANT: Escape all quotes and special characters inside the content strings properly so the JSON is valid.`;

    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 8000,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Groq error: ${err}`);
    }

    const groqData = await response.json();
    const raw = groqData.choices?.[0]?.message?.content ?? "";
    const cleaned = raw.replace(/```json|```/g, "").trim();

    let integrationResult;
    try {
      integrationResult = JSON.parse(cleaned);
    } catch {
      throw new Error("Groq returned malformed JSON. Please try again.");
    }

    // Merge: start with all original files, then overwrite/add with integration files
    const originalMap = new Map<string, string>(
      (originalFiles as RawFile[] ?? []).map((f) => [f.filename, f.content])
    );

    for (const f of integrationResult.files ?? []) {
      originalMap.set(f.filename, f.content);
    }

    const allFiles: RawFile[] = Array.from(originalMap.entries()).map(
      ([filename, content]) => ({ filename, content })
    );

    const result = {
      files: allFiles,
      packageInstall: integrationResult.packageInstall ?? "npm install @lifi/sdk @lifi/wallet-management",
      envVars: integrationResult.envVars ?? ["NEXT_PUBLIC_LIFI_INTEGRATOR=my-app"],
    };

    return NextResponse.json({ result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to generate integration";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}