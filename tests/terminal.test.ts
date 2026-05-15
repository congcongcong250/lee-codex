import { describe, expect, test } from "vitest";
import { colorizeVerboseDebugMessage } from "../src/terminal.js";

describe("colorizeVerboseDebugMessage", () => {
  test("colors verbose debug sections by message type", () => {
    expect(colorizeVerboseDebugMessage("Assistant content:\nhi", true)).toBe(
      "\u001b[36mAssistant content:\nhi\u001b[0m"
    );
    expect(colorizeVerboseDebugMessage("Tool calls:\n[]", true)).toBe(
      "\u001b[33mTool calls:\n[]\u001b[0m"
    );
    expect(colorizeVerboseDebugMessage("Tool result (ok):\n{}", true)).toBe(
      "\u001b[32mTool result (ok):\n{}\u001b[0m"
    );
    expect(colorizeVerboseDebugMessage("Resolver error:\nbad", true)).toBe(
      "\u001b[31mResolver error:\nbad\u001b[0m"
    );
    expect(colorizeVerboseDebugMessage("Raw response metadata:\n{}", true)).toBe(
      "\u001b[2mRaw response metadata:\n{}\u001b[0m"
    );
  });

  test("leaves messages plain when colors are disabled", () => {
    expect(colorizeVerboseDebugMessage("Assistant content:\nhi", false)).toBe(
      "Assistant content:\nhi"
    );
  });
});
