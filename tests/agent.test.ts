import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { runAgentTurn } from "../src/agent.js";
import { FakeModelClient, type ModelClient } from "../src/model.js";
import { createToolExecutor } from "../src/tools.js";
import type {
  AssistantChatMessage,
  ChatMessage,
  ModelRequest,
  ModelResponse,
  ToolCall,
  ToolResult
} from "../src/types.js";

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
      AssistantChatMessage | ((request: ModelRequest) => AssistantChatMessage)
    >
  ) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const response = this.responses[this.index];
    this.index += 1;

    if (response === undefined) {
      throw new Error("No response");
    }

    const message = typeof response === "function" ? response(request) : response;
    return {
      message,
      content: message.content,
      finishReason: message.tool_calls?.length ? "tool_calls" : "stop"
    };
  }
}

describe("runAgentTurn", () => {
  test("stops when the model returns a final answer", async () => {
    const result = await runAgentTurn({
      task: "say done",
      modelName: "fake",
      model: new FakeModelClient(["Done."]),
      tools: createToolExecutor({ workspaceRoot: workspace }),
      maxSteps: 15
    });

    expect(result).toMatchObject({
      status: "success",
      message: "Done.",
      steps: 1
    });
  });

  test("executes a native tool call and feeds the tool result back to the model", async () => {
    await writeFile(path.join(workspace, "note.txt"), "hello");
    const model = new RecordingModel([
      toolCallMessage("call_read", "read_file", { path: "note.txt" }),
      (request) => {
        expect(request.tools?.map((tool) => tool.function.name)).toEqual([
          "list_files",
          "read_file",
          "write_file",
          "run_command"
        ]);
        expect(request.toolChoice).toBe("auto");
        expect(request.parallelToolCalls).toBe(false);
        expect(request.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: "assistant",
              content: null,
              tool_calls: expect.arrayContaining([
                expect.objectContaining({ id: "call_read" })
              ])
            }),
            expect.objectContaining({
              role: "tool",
              tool_call_id: "call_read",
              content: expect.stringContaining("hello")
            })
          ])
        );
        return finalMessage("Read it.");
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

  test("executes multiple native tool calls sequentially in one step", async () => {
    const calls: ToolCall[] = [];
    const tools = {
      async execute(call: ToolCall): Promise<ToolResult> {
        calls.push(call);
        return { ok: true, data: { name: call.name } };
      }
    };
    const model = new RecordingModel([
      {
        role: "assistant",
        content: "I will inspect two things.",
        tool_calls: [
          nativeCall("call_list", "list_files", {}),
          nativeCall("call_read", "read_file", { path: "README.md" })
        ]
      },
      finalMessage("Done.")
    ]);

    const result = await runAgentTurn({
      task: "do two things",
      modelName: "fake",
      model,
      tools,
      maxSteps: 15
    });

    expect(result.status).toBe("success");
    expect(calls.map((call) => call.name)).toEqual(["list_files", "read_file"]);
    expect(result.toolSummaries).toEqual([
      "list_files -> ok",
      "read_file README.md -> ok"
    ]);
  });

  test("returns incomplete status when maxSteps is exhausted", async () => {
    const result = await runAgentTurn({
      task: "loop",
      modelName: "fake",
      model: new FakeModelClient([
        toolCallMessage("call_1", "list_files", {}),
        toolCallMessage("call_2", "list_files", {})
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
      toolCallMessage("call_missing", "missing_tool", {}),
      (request) => {
        expect(JSON.stringify(request.messages)).toContain(
          "Unknown tool missing_tool"
        );
        return finalMessage("Explained.");
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

  test("feeds malformed native tool arguments back as a tool error", async () => {
    const model = new RecordingModel([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_bad_args",
            type: "function",
            function: {
              name: "read_file",
              arguments: "{path: README.md}"
            }
          }
        ]
      },
      (request) => {
        expect(JSON.stringify(request.messages)).toContain(
          "Tool arguments were not valid JSON"
        );
        expect(request.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: "tool",
              tool_call_id: "call_bad_args"
            })
          ])
        );
        return finalMessage("Recovered.");
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
      steps: 2
    });
  });

  test("fails when native response cannot be resolved", async () => {
    const result = await runAgentTurn({
      task: "fail resolve",
      modelName: "fake",
      model: new FakeModelClient([{ role: "assistant", content: null }]),
      tools: createToolExecutor({ workspaceRoot: workspace }),
      maxSteps: 15
    });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      throw new Error("Expected failed result");
    }
    expect(result.error).toContain(
      "Assistant response had neither content nor tool_calls"
    );
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
        toolCallMessage("call_list", "list_files", {}),
        finalMessage("Done.")
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
    expect(debug.join("\n")).toContain("Assistant message:");
    expect(debug.join("\n")).toContain("Tool result:");
  });
});

function finalMessage(content: string): AssistantChatMessage {
  return { role: "assistant", content };
}

function toolCallMessage(
  id: string,
  name: string,
  args: Record<string, unknown>
): AssistantChatMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: [nativeCall(id, name, args)]
  };
}

function nativeCall(
  id: string,
  name: string,
  args: Record<string, unknown>
): AssistantChatMessage["tool_calls"] extends Array<infer T> | null | undefined
  ? T
  : never {
  return {
    id,
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(args)
    }
  };
}

function lastMessage(messages: ChatMessage[]): ChatMessage {
  const message = messages.at(-1);
  if (!message) {
    throw new Error("Expected at least one message");
  }
  return message;
}
