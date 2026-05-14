import { describe, expect, test } from "vitest";
import {
  buildRepairUserMessage,
  parseAgentAction,
  ProtocolParseError
} from "../src/protocol.js";

describe("parseAgentAction", () => {
  test("parses a valid tool action", () => {
    expect(
      parseAgentAction(
        '{"type":"tool","name":"read_file","args":{"path":"package.json"}}'
      )
    ).toEqual({
      type: "tool",
      name: "read_file",
      args: { path: "package.json" }
    });
  });

  test("parses a valid final action", () => {
    expect(parseAgentAction('{"type":"final","message":"Done."}')).toEqual({
      type: "final",
      message: "Done."
    });
  });

  test("rejects prose-wrapped JSON", () => {
    expect(() =>
      parseAgentAction('Here you go: {"type":"final","message":"Done."}')
    ).toThrow(ProtocolParseError);
  });

  test("rejects Markdown-fenced JSON", () => {
    expect(() =>
      parseAgentAction('```json\n{"type":"final","message":"Done."}\n```')
    ).toThrow(ProtocolParseError);
  });

  test("rejects unknown action types", () => {
    expect(() => parseAgentAction('{"type":"plan","message":"Soon."}')).toThrow(
      /type/
    );
  });

  test("rejects tool actions without object args", () => {
    expect(() =>
      parseAgentAction('{"type":"tool","name":"read_file","args":"bad"}')
    ).toThrow(/args/);
  });
});

describe("buildRepairUserMessage", () => {
  test("asks for exactly one strict JSON object", () => {
    const message = buildRepairUserMessage("Unexpected token", "not json");

    expect(message).toContain("Unexpected token");
    expect(message).toContain("Return exactly one strict JSON object");
    expect(message).toContain("not json");
  });
});
