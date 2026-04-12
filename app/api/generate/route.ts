import { NextRequest, NextResponse } from "next/server";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

type RawFile = { filename: string; content: string; binary?: boolean };

async function callGroq(prompt: string): Promise<string> {
  const body = JSON.stringify({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    max_tokens: 3000,
  });

  const attempt = async () =>
    fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body,
    });

  let res = await attempt();

  if (res.status === 429) {
    const errJson = await res.json().catch(() => ({}));
    const msg: string = errJson?.error?.message ?? "";
    const waitMatch = msg.match(/try again in ([0-9.]+)s/);
    const waitMs = waitMatch ? Math.ceil(parseFloat(waitMatch[1]) * 1000) + 500 : 12000;
    await new Promise((r) => setTimeout(r, waitMs));
    res = await attempt();
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq error: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

export async function POST(req: NextRequest) {
  try {
    const { analysis, originalFiles } = await req.json();

    if (!analysis) {
      return NextResponse.json({ error: "No analysis provided" }, { status: 400 });
    }

    const {
      stack,
      hasWagmi,
      hasViem,
      hasEthers,
      chains,
      tokens,
      existingDeps,
      entryFile,
    } = analysis;

    const files = (originalFiles as RawFile[]) ?? [];

    const fileMap = new Map<string, RawFile>();
    for (const f of files) {
      fileMap.set(f.filename, f);
    }

    const pkgFile = fileMap.get("package.json");
    const pkgContext = pkgFile ? pkgFile.content.slice(0, 400) : '{"dependencies":{}}';

    const codeSnippet = files
      .filter((f) => !f.binary && /\.(ts|tsx|js|jsx)$/.test(f.filename))
      .slice(0, 5)
      .map((f) => `// ${f.filename}\n${f.content.slice(0, 150)}`)
      .join("\n")
      .slice(0, 1500);

    const walletNote = hasWagmi
      ? "Use wagmi useWalletClient for getWalletClient in config"
      : hasEthers
      ? "Use ethers provider/signer pattern"
      : "Use generic wallet client pattern";

    // IMPORTANT: The prompt contains exact correct @lifi/sdk v3 code snippets
    // so the AI copies them instead of hallucinating old API shapes
    const prompt = `You are a Web3 code generator. Output ONLY raw JSON, no markdown, no explanation.

PROJECT INFO:
stack:${stack} | wagmi:${hasWagmi} | viem:${hasViem} | ethers:${hasEthers}
chains:${(chains || ["ethereum", "polygon"]).join(",")}
tokens:${(tokens || ["USDC", "ETH"]).join(",")}
entry:${entryFile}
deps:${(existingDeps || []).slice(0, 10).join(",")}
wallet:${walletNote}

package.json: ${pkgContext}
code: ${codeSnippet}

OUTPUT THIS JSON SHAPE:
{"files":[{"filename":"lib/lifi/config.ts","content":"..."},{"filename":"hooks/useLiFiRoute.ts","content":"..."},{"filename":"hooks/useLiFiSwap.ts","content":"..."},{"filename":"LIFI_INTEGRATION.md","content":"..."},{"filename":"package.json","content":"..."}],"packageInstall":"npm install @lifi/sdk @lifi/wallet-management","envVars":["NEXT_PUBLIC_LIFI_INTEGRATOR=my-app"]}

===CRITICAL: COPY THESE EXACT CODE PATTERNS. DO NOT MODIFY THE API CALLS.===

lib/lifi/config.ts — USE EXACTLY THIS STRUCTURE:
import { createConfig, EVM } from '@lifi/sdk';
export const initLiFi = () => createConfig({
  integrator: process.env.NEXT_PUBLIC_LIFI_INTEGRATOR ?? 'my-app',
  providers: [EVM({ getWalletClient: async () => { throw new Error('Provide wallet client') } })],
});
FORBIDDEN: chainIds, chains, rpcUrls, network — these properties DO NOT EXIST in @lifi/sdk v3.

hooks/useLiFiRoute.ts — getRoutes() signature is EXACTLY:
import { getRoutes } from '@lifi/sdk';
const result = await getRoutes({ fromChainId:number, toChainId:number, fromTokenAddress:string, toTokenAddress:string, fromAmount:string, fromAddress:string });
const routes = result.routes; // RouteExtended[]

hooks/useLiFiSwap.ts — executeRoute() signature is EXACTLY:
import { executeRoute } from '@lifi/sdk';
await executeRoute(route, { updateRouteHook: (r) => console.log(r.steps[0].execution?.status) });

OTHER FILES:
- LIFI_INTEGRATION.md: setup steps, env vars, usage examples
- package.json: keep ALL existing content exactly, only add "@lifi/sdk":"^3.0.0" and "@lifi/wallet-management":"^3.0.0" to dependencies
===END CRITICAL SECTION===`;

    const raw = await callGroq(prompt);
    const cleaned = raw.replace(/```json|```/g, "").trim();

    let integrationResult;
    try {
      integrationResult = JSON.parse(cleaned);
    } catch {
      throw new Error("AI returned malformed JSON. Please try again.");
    }

    for (const f of integrationResult.files ?? []) {
      fileMap.set(f.filename, { filename: f.filename, content: f.content, binary: false });
    }

    const allFiles = Array.from(fileMap.values());

    return NextResponse.json({
      result: {
        files: allFiles,
        packageInstall:
          integrationResult.packageInstall ??
          "npm install @lifi/sdk @lifi/wallet-management",
        envVars: integrationResult.envVars ?? ["NEXT_PUBLIC_LIFI_INTEGRATOR=my-app"],
        newFileCount: integrationResult.files?.length ?? 0,
        totalFileCount: allFiles.length,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to generate integration";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}