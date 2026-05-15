import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createConversationLog } from "../src/conversationLog.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lee-codex-log-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("createConversationLog", () => {
  test("writes an envelope with replayable messages and events", async () => {
    const log = await createConversationLog({
      logDir: directory,
      provider: "openrouter",
      model: "openai/gpt-oss-120b:free",
      cwd: "/workspace"
    });

    await log.recordMessages([
      { role: "system", content: "system prompt" },
      { role: "user", content: "read README" },
      {
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
      {
        role: "tool",
        tool_call_id: "call_read",
        name: "read_file",
        content: "{\"ok\":true}"
      }
    ]);
    await log.recordEvent({
      type: "tool_result",
      toolCallId: "call_read",
      result: { ok: true }
    });
    await log.finish("success");

    const envelope = JSON.parse(await readFile(log.filePath, "utf8"));
    expect(envelope).toMatchObject({
      version: 1,
      status: "success",
      provider: "openrouter",
      model: "openai/gpt-oss-120b:free",
      cwd: "/workspace"
    });
    expect(envelope.startedAt).toEqual(expect.any(String));
    expect(envelope.updatedAt).toEqual(expect.any(String));
    expect(envelope.messages).toHaveLength(4);
    expect(envelope.messages[2].tool_calls[0].id).toBe("call_read");
    expect(envelope.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_result",
          toolCallId: "call_read",
          result: { ok: true },
          timestamp: expect.any(String)
        }),
        expect.objectContaining({
          type: "status",
          status: "success",
          timestamp: expect.any(String)
        })
      ])
    );
  });
});
