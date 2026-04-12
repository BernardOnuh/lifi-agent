import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";

const TEXT_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".json", ".md",
  ".css", ".scss", ".html", ".env.example", ".mjs", ".cjs"
];

function isTextFile(filename: string) {
  return TEXT_EXTENSIONS.some(ext => filename.endsWith(ext));
}

export async function POST(req: NextRequest) {
  try {
    const { repoUrl } = await req.json();
    if (!repoUrl || typeof repoUrl !== "string") {
      return NextResponse.json({ error: "No repo URL provided" }, { status: 400 });
    }

    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      return NextResponse.json({ error: "Invalid GitHub URL" }, { status: 400 });
    }
    const [, owner, repo] = match;
    const cleanRepo = repo.replace(/\.git$/, "");

    const zipUrl = `https://api.github.com/repos/${owner}/${cleanRepo}/zipball`;
    const zipRes = await fetch(zipUrl, {
      headers: { Accept: "application/vnd.github+json" },
    });

    if (!zipRes.ok) {
      throw new Error(`GitHub error: ${zipRes.status} — repo may be private or not found`);
    }

    const buffer = await zipRes.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);

    const chunks: string[] = [];
    let totalLength = 0;
    const MAX = 12000;

    for (const [filename, file] of Object.entries(zip.files)) {
      if (file.dir) continue;
      const shortName = filename.split("/").slice(1).join("/");
      if (!isTextFile(shortName)) continue;
      if (shortName.includes("node_modules")) continue;
      if (shortName.includes(".next")) continue;

      const content = await file.async("string");
      const chunk = `\n// FILE: ${shortName}\n${content}\n`;
      chunks.push(chunk);
      totalLength += chunk.length;
      if (totalLength >= MAX) break;
    }

    const code = chunks.join("").slice(0, MAX);

    return NextResponse.json({ code });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to fetch repo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
