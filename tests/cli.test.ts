import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { parseCliArgs, runCli } from "../src/cli.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "lee-codex-cli-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("parseCliArgs", () => {
  test("defaults to interactive mode with OpenRouter defaults", async () => {
    const config = await parseCliArgs(["node", "lee-codex"], {
      defaultCwd: workspace
    });

    expect(config).toMatchObject({
      mode: "interactive",
      provider: "openrouter",
      model: "openai/gpt-oss-120b:free",
      cwd: workspace,
      maxSteps: 15,
      yes: false,
      verbose: false
    });
  });

  test("uses single-shot mode when a task is provided", async () => {
    const config = await parseCliArgs(["node", "lee-codex", "create README"], {
      defaultCwd: workspace
    });

    expect(config).toMatchObject({
      mode: "single",
      task: "create README"
    });
  });

  test("validates --cwd", async () => {
    await expect(
      parseCliArgs(["node", "lee-codex", "--cwd", path.join(workspace, "missing")])
    ).rejects.toThrow(/does not exist/);
  });

  test("parses debug and safety options", async () => {
    const config = await parseCliArgs(
      [
        "node",
        "lee-codex",
        "--cwd",
        workspace,
        "--provider",
        "openai",
        "--model",
        "gpt-test",
        "--max-steps",
        "3",
        "--max-read-bytes",
        "100",
        "--command-timeout-ms",
        "250",
        "--yes",
        "--verbose",
        "task"
      ],
      { defaultCwd: process.cwd() }
    );

    expect(config).toMatchObject({
      mode: "single",
      task: "task",
      cwd: workspace,
      provider: "openai",
      model: "gpt-test",
      maxSteps: 3,
      maxReadBytes: 100,
      commandTimeoutMs: 250,
      yes: true,
      verbose: true
    });
  });
});

describe("runCli", () => {
  test("dispatches to single-shot runner", async () => {
    const calls: string[] = [];
    const exitCode = await runCli(["node", "lee-codex", "do work"], {
      defaultCwd: workspace,
      runSingleShot: async (config) => {
        calls.push(`${config.mode}:${config.task}`);
        return 0;
      },
      runInteractive: async () => 1
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual(["single:do work"]);
  });

  test("dispatches to interactive runner when no task is provided", async () => {
    const calls: string[] = [];
    const exitCode = await runCli(["node", "lee-codex"], {
      defaultCwd: workspace,
      runSingleShot: async () => 1,
      runInteractive: async (config) => {
        calls.push(config.mode);
        return 0;
      }
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual(["interactive"]);
  });

  test("returns zero for --help", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const exitCode = await runCli(["node", "lee-codex", "--help"], {
      defaultCwd: workspace,
      runSingleShot: async () => 1,
      runInteractive: async () => 1
    });

    expect(exitCode).toBe(0);
  });
});
