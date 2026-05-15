import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { runAgentTurn } from "../src/agent.js";
import { FakeModelClient, type ModelClient } from "../src/model.js";
import { createToolExecutor } from "../src/tools.js";
import type { ChatMessage, ModelRequest, ModelResponse, ToolCall, ToolResult } from "../src/types.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "lee-codex-agent-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

class RecordingModel implements ModelClient {
  readonly requests: ModelRequest[] = [];
  private index = 0;

  constructor(
    private readonly responses: Array<
      string | ((request: ModelRequest) => string)
    >
  ) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const response = this.responses[this.index];
    this.index += 1;

    if (response === undefined) {
      throw new Error("No response");
    }

    const content = typeof response === "function" ? response(request) : response;
    return {
      message: { role: "assistant", content },
      content
    };
  }
}

describe("runAgentTurn", () => {
  test("stops when the model returns a final answer", async () => {
    const result = await runAgentTurn({
      task: "say done",
      modelName: "fake",
      model: new FakeModelClient(['{"type":"final","message":"Done."}']),
      tools: createToolExecutor({ workspaceRoot: workspace }),
      maxSteps: 15
    });

    expect(result).toMatchObject({
      status: "success",
      message: "Done.",
      steps: 1
    });
  });

  test("executes a tool and feeds the result back to the model", async () => {
    await writeFile(path.join(workspace, "note.txt"), "hello");
    const model = new RecordingModel([
      '{"type":"tool","name":"read_file","args":{"path":"note.txt"}}',
      (request) => {
        expect(JSON.stringify(request.messages)).toContain("hello");
        return '{"type":"final","message":"Read it."}';
      }
    ]);

    const result = await runAgentTurn({
      task: "read note",
      modelName: "fake",
      model,
      tools: createToolExecutor({ workspaceRoot: workspace }),
      maxSteps: 15
    });

    expect(result.status).toBe("success");
    expect(result.toolSummaries).toEqual(["read_file note.txt -> ok"]);
  });

  test("returns incomplete status when maxSteps is exhausted", async () => {
    const result = await runAgentTurn({
      task: "loop",
      modelName: "fake",
      model: new FakeModelClient([
        '{"type":"tool","name":"list_files","args":{}}',
        '{"type":"tool","name":"list_files","args":{}}'
      ]),
      tools: createToolExecutor({ workspaceRoot: workspace }),
      maxSteps: 2
    });

    expect(result).toMatchObject({
      status: "incomplete",
      error: "Agent stopped after 2 steps without a final answer.",
      steps: 2
    });
  });

  test("feeds unknown tool errors back into the loop", async () => {
    const model = new RecordingModel([
      '{"type":"tool","name":"missing_tool","args":{}}',
      (request) => {
        expect(JSON.stringify(request.messages)).toContain("Unknown tool missing_tool");
        return '{"type":"final","message":"Explained."}';
      }
    ]);

    const result = await runAgentTurn({
      task: "use bad tool",
      modelName: "fake",
      model,
      tools: createToolExecutor({ workspaceRoot: workspace }),
      maxSteps: 15
    });

    expect(result.status).toBe("success");
    expect(result.toolSummaries).toEqual(["missing_tool -> error"]);
  });

  test("allows one repair retry after invalid JSON", async () => {
    const model = new RecordingModel([
      "not json",
      (request) => {
        expect(lastMessage(request.messages).content).toContain(
          "Return exactly one strict JSON object"
        );
        return '{"type":"final","message":"Recovered."}';
      }
    ]);

    const result = await runAgentTurn({
      task: "recover",
      modelName: "fake",
      model,
      tools: createToolExecutor({ workspaceRoot: workspace }),
      maxSteps: 15
    });

    expect(result).toMatchObject({
      status: "success",
      message: "Recovered.",
      steps: 1
    });
  });

  test("fails after a second invalid JSON response", async () => {
    const result = await runAgentTurn({
      task: "fail parse",
      modelName: "fake",
      model: new FakeModelClient(["not json", "also not json"]),
      tools: createToolExecutor({ workspaceRoot: workspace }),
      maxSteps: 15
    });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      throw new Error("Expected failed result");
    }
    expect(result.error).toContain("Model response is not valid JSON");
  });

  test("logs concise steps and verbose debug details", async () => {
    const steps: string[] = [];
    const debug: string[] = [];
    const tools = {
      async execute(_call: ToolCall): Promise<ToolResult> {
        return { ok: true, data: { files: [] } };
      }
    };

    await runAgentTurn({
      task: "list",
      modelName: "fake",
      model: new FakeModelClient([
        '{"type":"tool","name":"list_files","args":{}}',
        '{"type":"final","message":"Done."}'
      ]),
      tools,
      maxSteps: 15,
      verbose: true,
      logger: {
        step: (message) => steps.push(message),
        debug: (message) => debug.push(message),
        info() {},
        error() {}
      }
    });

    expect(steps).toEqual(["Step 1/15: list_files"]);
    expect(debug.join("\n")).toContain("Model JSON:");
    expect(debug.join("\n")).toContain("Tool result:");
  });
});

function lastMessage(messages: ChatMessage[]): ChatMessage {
  const message = messages.at(-1);
  if (!message) {
    throw new Error("Expected at least one message");
  }
  return message;
}
