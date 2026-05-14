import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createToolExecutor } from "../src/tools.js";
import { resolveWorkspacePath, validateWorkspaceRoot } from "../src/workspace.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "lee-codex-tools-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("workspace helpers", () => {
  test("validateWorkspaceRoot requires an existing directory", async () => {
    await expect(validateWorkspaceRoot(workspace)).resolves.toBe(
      path.resolve(workspace)
    );
    await expect(validateWorkspaceRoot(path.join(workspace, "missing"))).rejects.toThrow(
      /does not exist/
    );
  });

  test("resolveWorkspacePath rejects paths outside the workspace", () => {
    expect(() => resolveWorkspacePath(workspace, "../outside.txt")).toThrow(
      /outside the workspace/
    );
  });
});

describe("list_files", () => {
  test("lists files recursively while skipping heavy directories", async () => {
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await mkdir(path.join(workspace, "node_modules/pkg"), { recursive: true });
    await mkdir(path.join(workspace, ".git/objects"), { recursive: true });
    await mkdir(path.join(workspace, "dist"), { recursive: true });
    await mkdir(path.join(workspace, "build"), { recursive: true });
    await mkdir(path.join(workspace, "coverage"), { recursive: true });
    await writeFile(path.join(workspace, "README.md"), "hi");
    await writeFile(path.join(workspace, "src/index.ts"), "export {};");
    await writeFile(path.join(workspace, "node_modules/pkg/index.js"), "ignored");
    await writeFile(path.join(workspace, ".git/config"), "ignored");
    await writeFile(path.join(workspace, "dist/index.js"), "ignored");
    await writeFile(path.join(workspace, "build/index.js"), "ignored");
    await writeFile(path.join(workspace, "coverage/report.txt"), "ignored");

    const tools = createToolExecutor({ workspaceRoot: workspace });
    const result = await tools.execute({
      name: "list_files",
      args: { path: "." }
    });

    expect(result).toEqual({
      ok: true,
      data: {
        files: ["README.md", "src/index.ts"],
        truncated: false
      }
    });
  });

  test("respects maxFiles", async () => {
    await writeFile(path.join(workspace, "a.txt"), "a");
    await writeFile(path.join(workspace, "b.txt"), "b");

    const tools = createToolExecutor({ workspaceRoot: workspace });
    const result = await tools.execute({
      name: "list_files",
      args: { maxFiles: 1 }
    });

    expect(result).toEqual({
      ok: true,
      data: {
        files: ["a.txt"],
        truncated: true
      }
    });
  });
});

describe("read_file", () => {
  test("reads files inside the workspace", async () => {
    await writeFile(path.join(workspace, "note.txt"), "hello");

    const tools = createToolExecutor({ workspaceRoot: workspace });
    const result = await tools.execute({
      name: "read_file",
      args: { path: "note.txt" }
    });

    expect(result).toEqual({
      ok: true,
      data: {
        path: "note.txt",
        content: "hello",
        bytes: 5
      }
    });
  });

  test("rejects oversized files", async () => {
    await writeFile(path.join(workspace, "large.txt"), "abcdef");

    const tools = createToolExecutor({ workspaceRoot: workspace, maxReadBytes: 3 });
    const result = await tools.execute({
      name: "read_file",
      args: { path: "large.txt" }
    });

    expect(result).toEqual({
      ok: false,
      error: "File large.txt is 6 bytes, exceeding the 3 byte read limit."
    });
  });
});

describe("write_file", () => {
  test("requires confirmation unless autoApprove is set", async () => {
    const tools = createToolExecutor({ workspaceRoot: workspace });
    const result = await tools.execute({
      name: "write_file",
      args: { path: "new.txt", content: "hello" }
    });

    expect(result).toEqual({
      ok: false,
      error: "Tool write_file requires confirmation."
    });
  });

  test("returns a structured error when denied", async () => {
    const tools = createToolExecutor({
      workspaceRoot: workspace,
      confirm: async () => false
    });
    const result = await tools.execute({
      name: "write_file",
      args: { path: "new.txt", content: "hello" }
    });

    expect(result).toEqual({
      ok: false,
      error: "User denied tool call write_file."
    });
  });

  test("writes files when auto-approved", async () => {
    const tools = createToolExecutor({ workspaceRoot: workspace, autoApprove: true });
    const result = await tools.execute({
      name: "write_file",
      args: { path: "nested/new.txt", content: "hello" }
    });

    expect(result).toEqual({
      ok: true,
      data: {
        path: "nested/new.txt",
        bytes: 5
      }
    });
    await expect(readFile(path.join(workspace, "nested/new.txt"), "utf8")).resolves.toBe(
      "hello"
    );
  });
});

describe("run_command", () => {
  test("requires confirmation unless autoApprove is set", async () => {
    const tools = createToolExecutor({ workspaceRoot: workspace });
    const result = await tools.execute({
      name: "run_command",
      args: { command: "pwd" }
    });

    expect(result).toEqual({
      ok: false,
      error: "Tool run_command requires confirmation."
    });
  });

  test("returns a structured error when denied", async () => {
    const tools = createToolExecutor({
      workspaceRoot: workspace,
      confirm: async () => false
    });
    const result = await tools.execute({
      name: "run_command",
      args: { command: "pwd" }
    });

    expect(result).toEqual({
      ok: false,
      error: "User denied tool call run_command."
    });
  });

  test("runs commands in the workspace", async () => {
    const tools = createToolExecutor({ workspaceRoot: workspace, autoApprove: true });
    const result = await tools.execute({
      name: "run_command",
      args: { command: "pwd" }
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      exitCode: 0,
      stderr: "",
      timedOut: false
    });
    expect(String((result.data as { stdout: string }).stdout).trim()).toBe(
      await realpath(workspace)
    );
  });

  test("reports timed out commands", async () => {
    const tools = createToolExecutor({
      workspaceRoot: workspace,
      autoApprove: true,
      commandTimeoutMs: 20
    });
    const result = await tools.execute({
      name: "run_command",
      args: {
        command:
          "node -e \"setTimeout(() => console.log('late'), 200)\""
      }
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      exitCode: null,
      timedOut: true
    });
  });

  test("caps stdout and stderr", async () => {
    const tools = createToolExecutor({
      workspaceRoot: workspace,
      autoApprove: true,
      commandOutputBytes: 4
    });
    const result = await tools.execute({
      name: "run_command",
      args: {
        command:
          "node -e \"console.log('abcdef'); console.error('ghijkl')\""
      }
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      stdout: "abcd",
      stderr: "ghij",
      timedOut: false
    });
  });
});
