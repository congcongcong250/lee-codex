import { describe, expect, test } from "vitest";
import { resolveNativeResponse } from "../src/resolvers/native.js";
import type { ChatToolCall, ModelResponse } from "../src/types.js";

describe("resolveNativeResponse", () => {
  test("treats assistant content without tool calls as final", () => {
    const result = resolveNativeResponse(response({ content: "Done." }));

    expect(result).toEqual({
      type: "final",
      message: "Done.",
      assistantMessage: { role: "assistant", content: "Done." }
    });
  });

  test("extracts one native function tool call", () => {
    const result = resolveNativeResponse(
      response({
        content: null,
        tool_calls: [
          {
            id: "call_read",
            type: "function",
            function: {
              name: "read_file",
              arguments: "{\"path\":\"README.md\"}"
            }
          }
        ]
      })
    );

    expect(result).toEqual({
      type: "tool_calls",
      assistantMessage: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_read",
            type: "function",
            function: {
              name: "read_file",
              arguments: "{\"path\":\"README.md\"}"
            }
          }
        ]
      },
      calls: [
        {
          status: "ready",
          id: "call_read",
          name: "read_file",
          args: { path: "README.md" }
        }
      ]
    });
  });

  test("keeps malformed arguments recoverable when tool_call_id exists", () => {
    const result = resolveNativeResponse(
      response({
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
      })
    );

    expect(result.type).toBe("tool_calls");
    if (result.type !== "tool_calls") {
      throw new Error("Expected tool call result");
    }
    expect(result.calls).toEqual([
      {
        status: "invalid",
        id: "call_bad_args",
        name: "read_file",
        error: expect.stringContaining("Tool arguments were not valid JSON")
      }
    ]);
  });

  test("fails when a native tool call is missing an id", () => {
    const result = resolveNativeResponse(
      response({
        content: null,
        tool_calls: [
          {
            id: "",
            type: "function",
            function: {
              name: "read_file",
              arguments: "{\"path\":\"README.md\"}"
            }
          }
        ]
      })
    );

    expect(result).toEqual({
      type: "failed",
      error: "Native tool call at index 0 is missing a non-empty id."
    });
  });

  test("fails when assistant message has neither content nor tool calls", () => {
    const result = resolveNativeResponse(response({ content: null }));

    expect(result).toEqual({
      type: "failed",
      error: "Assistant response had neither content nor tool_calls."
    });
  });
});

function response(
  message: {
    content: string | null;
    tool_calls?: ChatToolCall[] | null;
  }
): ModelResponse {
  const assistantMessage: ModelResponse["message"] = {
    role: "assistant",
    content: message.content,
    ...(message.tool_calls !== undefined ? { tool_calls: message.tool_calls } : {})
  };
  return {
    message: assistantMessage,
    content: assistantMessage.content,
    finishReason: null,
    raw: { choices: [{ message: assistantMessage }] }
  };
}
