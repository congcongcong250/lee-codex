import { createInterface, type Interface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import type { AgentTurnResult } from "./agent.js";
import type { SessionHistoryEntry } from "./types.js";

export type { AgentTurnResult } from "./agent.js";

export interface ChatIO {
  question(prompt: string): Promise<string>;
  write(message: string): void;
  close(): void;
}

export type RunTurnForChat = (
  task: string,
  history: SessionHistoryEntry[]
) => Promise<AgentTurnResult>;

export interface ChatSessionOptions {
  io: ChatIO;
  runTurn: RunTurnForChat;
  initialHistory?: SessionHistoryEntry[];
}

export async function runChatSession(options: ChatSessionOptions): Promise<void> {
  const history = [...(options.initialHistory ?? [])];

  while (true) {
    const input = (await options.io.question("lee-codex> ")).trim();

    if (input.length === 0) {
      continue;
    }

    if (input === "/exit") {
      break;
    }

    if (input === "/help") {
      options.io.write("Commands: /help, /exit\n");
      continue;
    }

    try {
      const result = await options.runTurn(input, history);

      if (result.status === "success") {
        options.io.write(`${result.message}\n`);
        history.push({ role: "user", content: input });
        history.push({ role: "assistant", content: result.message });
        for (const summary of result.toolSummaries) {
          history.push({ role: "tool", content: `Tool: ${summary}` });
        }
      } else {
        options.io.write(`${result.error}\n`);
      }
    } catch (error) {
      options.io.write(`${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  options.io.close();
}

export function createReadlineChatIO(
  input: Readable,
  output: Writable
): ChatIO {
  const readline = createInterface({ input, output });

  return new ReadlineChatIO(readline, output);
}

class ReadlineChatIO implements ChatIO {
  constructor(
    private readonly readline: Interface,
    private readonly output: Writable
  ) {}

  async question(prompt: string): Promise<string> {
    return this.readline.question(prompt);
  }

  write(message: string): void {
    this.output.write(message);
  }

  close(): void {
    this.readline.close();
  }
}
