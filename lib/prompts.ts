export const ANALYSE_PROMPT = `
You are an expert code analyser. A developer will paste their project code.
Return ONLY a JSON object with this exact structure, no markdown, no backticks:

{
  "stack": "nextjs" | "vite" | "node",
  "hasWagmi": boolean,
  "hasEthers": boolean,
  "hasViem": boolean,
  "chains": string[],
  "tokens": string[],
  "existingDeps": string[],
  "entryFile": string,
  "summary": string
}
`;

export const GENERATE_PROMPT = (analysis: string) => `
You are an expert LI.FI integration engineer.
Project analysis: ${analysis}

Return ONLY a JSON object with this exact structure, no markdown, no backticks:

{
  "files": [
    {
      "filename": "lib/lifi.config.ts",
      "content": "full file content here"
    },
    {
      "filename": "components/LiFiWidget.tsx",
      "content": "full file content here"
    },
    {
      "filename": "hooks/useLiFi.ts",
      "content": "full file content here"
    },
    {
      "filename": "LIFI_SETUP.md",
      "content": "step by step setup instructions"
    }
  ],
  "packageInstall": "npm install @lifi/sdk @lifi/widget",
  "envVars": ["NEXT_PUBLIC_LIFI_API_KEY=your_key_here"]
}
`;
