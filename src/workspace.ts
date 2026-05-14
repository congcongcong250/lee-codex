import { stat } from "node:fs/promises";
import path from "node:path";

export async function validateWorkspaceRoot(workspaceRoot: string): Promise<string> {
  const resolved = path.resolve(workspaceRoot);
  let stats;

  try {
    stats = await stat(resolved);
  } catch {
    throw new Error(`Workspace ${workspaceRoot} does not exist.`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Workspace ${workspaceRoot} is not a directory.`);
  }

  return resolved;
}

export function resolveWorkspacePath(
  workspaceRoot: string,
  requestedPath = "."
): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, requestedPath);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path ${requestedPath} is outside the workspace.`);
  }

  return resolved;
}

export function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string {
  const relative = path.relative(path.resolve(workspaceRoot), absolutePath);
  return relative === "" ? "." : relative.split(path.sep).join("/");
}
