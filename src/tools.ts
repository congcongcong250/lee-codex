import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_COMMAND_OUTPUT_BYTES,
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_READ_BYTES,
  type ToolCall,
  type ToolResult
} from "./types.js";
import { resolveWorkspacePath, toWorkspaceRelative } from "./workspace.js";

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage"
]);

export interface ToolExecutorOptions {
  workspaceRoot: string;
  autoApprove?: boolean;
  confirm?: (call: ToolCall) => Promise<boolean>;
  maxReadBytes?: number;
  defaultMaxFiles?: number;
  commandTimeoutMs?: number;
  commandOutputBytes?: number;
}

export interface ToolExecutor {
  execute(call: ToolCall): Promise<ToolResult>;
}

export function createToolExecutor(options: ToolExecutorOptions): ToolExecutor {
  const workspaceRoot = path.resolve(options.workspaceRoot);

  return {
    async execute(call) {
      try {
        switch (call.name) {
          case "list_files":
            return ok(
              await listFiles(workspaceRoot, call.args, options.defaultMaxFiles)
            );
          case "read_file":
            return ok(await readWorkspaceFile(workspaceRoot, call.args, options));
          case "write_file":
            return withApproval(options, call, async () =>
              ok(await writeWorkspaceFile(workspaceRoot, call.args))
            );
          case "run_command":
            return withApproval(options, call, async () =>
              ok(await runWorkspaceCommand(workspaceRoot, call.args, options))
            );
          default:
            return fail(`Unknown tool ${call.name}.`);
        }
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    }
  };
}

async function withApproval(
  options: ToolExecutorOptions,
  call: ToolCall,
  execute: () => Promise<ToolResult>
): Promise<ToolResult> {
  if (options.autoApprove) {
    return execute();
  }

  if (!options.confirm) {
    return fail(`Tool ${call.name} requires confirmation.`);
  }

  const approved = await options.confirm(call);
  if (!approved) {
    return fail(`User denied tool call ${call.name}.`);
  }

  return execute();
}

async function listFiles(
  workspaceRoot: string,
  args: Record<string, unknown>,
  defaultMaxFiles = DEFAULT_MAX_FILES
): Promise<{ files: string[]; truncated: boolean }> {
  const requestedPath = optionalString(args.path, "path") ?? ".";
  const maxFiles = optionalPositiveInteger(args.maxFiles, "maxFiles") ?? defaultMaxFiles;
  const start = resolveWorkspacePath(workspaceRoot, requestedPath);
  const files: string[] = [];
  let truncated = false;

  async function visit(directory: string): Promise<void> {
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }

    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }

      const absolute = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          await visit(absolute);
        }
        continue;
      }

      if (entry.isFile()) {
        files.push(toWorkspaceRelative(workspaceRoot, absolute));
      }
    }
  }

  const startStats = await stat(start);
  if (startStats.isFile()) {
    files.push(toWorkspaceRelative(workspaceRoot, start));
  } else if (startStats.isDirectory()) {
    await visit(start);
  } else {
    throw new Error(`Path ${requestedPath} is neither a file nor a directory.`);
  }

  return { files, truncated };
}

async function readWorkspaceFile(
  workspaceRoot: string,
  args: Record<string, unknown>,
  options: ToolExecutorOptions
): Promise<{ path: string; content: string; bytes: number }> {
  const requestedPath = requiredString(args.path, "path");
  const absolute = resolveWorkspacePath(workspaceRoot, requestedPath);
  const stats = await stat(absolute);
  const maxReadBytes = options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES;

  if (!stats.isFile()) {
    throw new Error(`Path ${requestedPath} is not a file.`);
  }

  if (stats.size > maxReadBytes) {
    throw new Error(
      `File ${requestedPath} is ${stats.size} bytes, exceeding the ${maxReadBytes} byte read limit.`
    );
  }

  const content = await readFile(absolute, "utf8");
  return {
    path: toWorkspaceRelative(workspaceRoot, absolute),
    content,
    bytes: Buffer.byteLength(content)
  };
}

async function writeWorkspaceFile(
  workspaceRoot: string,
  args: Record<string, unknown>
): Promise<{ path: string; bytes: number }> {
  const requestedPath = requiredString(args.path, "path");
  const content = requiredString(args.content, "content");
  const absolute = resolveWorkspacePath(workspaceRoot, requestedPath);

  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content, "utf8");

  return {
    path: toWorkspaceRelative(workspaceRoot, absolute),
    bytes: Buffer.byteLength(content)
  };
}

async function runWorkspaceCommand(
  workspaceRoot: string,
  args: Record<string, unknown>,
  options: ToolExecutorOptions
): Promise<{
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  const command = requiredString(args.command, "command");
  const timeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const outputBytes = options.commandOutputBytes ?? DEFAULT_COMMAND_OUTPUT_BYTES;

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: workspaceRoot,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = createCappedCollector(outputBytes);
    const stderr = createCappedCollector(outputBytes);
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        command,
        exitCode: null,
        stdout: stdout.text(),
        stderr: stderr.text() + error.message,
        timedOut
      });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        command,
        exitCode: timedOut ? null : code,
        stdout: stdout.text(),
        stderr: stderr.text(),
        timedOut
      });
    });
  });
}

function createCappedCollector(maxBytes: number): {
  push(chunk: Buffer): void;
  text(): string;
} {
  let buffer = Buffer.alloc(0);

  return {
    push(chunk) {
      if (buffer.length >= maxBytes) {
        return;
      }

      const remaining = maxBytes - buffer.length;
      buffer = Buffer.concat([buffer, chunk.subarray(0, remaining)]);
    },
    text() {
      return buffer.toString("utf8");
    }
  };
}

function ok(data: unknown): ToolResult {
  return { ok: true, data };
}

function fail(error: string): ToolResult {
  return { ok: false, error };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string.`);
  }
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string.`);
  }
  return value;
}

function optionalPositiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}
