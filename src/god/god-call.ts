import type { GodAdapter } from '../types/god-adapter.js';

export interface GodCallOptions {
  adapter: GodAdapter;
  prompt: string;
  systemPrompt: string;
  projectDir?: string;
  timeoutMs: number;
}

export async function collectGodAdapterOutput(options: GodCallOptions): Promise<string> {
  const { adapter, prompt, systemPrompt, projectDir, timeoutMs } = options;
  const chunks: string[] = [];

  try {
    for await (const chunk of adapter.execute(prompt, {
      cwd: projectDir ?? process.cwd(),
      systemPrompt,
      timeoutMs,
    })) {
      if (chunk.type === 'tool_use' || chunk.type === 'tool_result') {
        throw new Error(`God adapter ${adapter.name} attempted tool use, which is not allowed`);
      }

      if (chunk.type === 'text' || chunk.type === 'code' || chunk.type === 'error') {
        chunks.push(chunk.content);
      }
    }

    return chunks.join('');
  } finally {
    if (typeof adapter.isRunning === 'function' && adapter.isRunning()) {
      await adapter.kill().catch(() => {});
    }
  }
}
