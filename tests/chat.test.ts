import { describe, expect, test } from "vitest";
import { runChatSession, type ChatIO } from "../src/chat.js";
import type { AgentTurnResult, RunTurnForChat } from "../src/chat.js";

class FakeIO implements ChatIO {
  readonly output: string[] = [];
  private index = 0;

  constructor(private readonly inputs: string[]) {}

  async question(prompt: string): Promise<string> {
    this.output.push(prompt);
    const value = this.inputs[this.index];
    this.index += 1;
    return value ?? "/exit";
  }

  write(message: string): void {
    this.output.push(message);
  }

  close(): void {}
}

describe("runChatSession", () => {
  test("exits on /exit", async () => {
    const io = new FakeIO(["/exit"]);
    const turns: string[] = [];

    await runChatSession({
      io,
      runTurn: async (task) => {
        turns.push(task);
        return success("unused");
      }
    });

    expect(turns).toEqual([]);
  });

  test("prints help for /help", async () => {
    const io = new FakeIO(["/help", "/exit"]);

    await runChatSession({
      io,
      runTurn: async () => success("unused")
    });

    expect(io.output.join("\n")).toContain("/exit");
    expect(io.output.join("\n")).toContain("/help");
  });

  test("keeps compact history after successful turns", async () => {
    const io = new FakeIO(["create README", "now edit it", "/exit"]);
    const historyLengths: number[] = [];
    const runTurn: RunTurnForChat = async (_task, history) => {
      historyLengths.push(history.length);
      return {
        status: "success",
        message: `done ${historyLengths.length}`,
        steps: 1,
        toolSummaries: ["write_file README.md -> ok"]
      };
    };

    await runChatSession({ io, runTurn });

    expect(historyLengths).toEqual([0, 3]);
  });

  test("keeps session alive after provider failure without storing success history", async () => {
    const io = new FakeIO(["first", "second", "/exit"]);
    const historyLengths: number[] = [];
    const runTurn: RunTurnForChat = async (_task, history) => {
      historyLengths.push(history.length);
      if (historyLengths.length === 1) {
        throw new Error("provider failed");
      }
      return success("recovered");
    };

    await runChatSession({ io, runTurn });

    expect(historyLengths).toEqual([0, 0]);
    expect(io.output.join("\n")).toContain("provider failed");
    expect(io.output.join("\n")).toContain("recovered");
  });
});

function success(message: string): AgentTurnResult {
  return {
    status: "success",
    message,
    steps: 1,
    toolSummaries: []
  };
}
