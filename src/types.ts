export const DEFAULT_PROVIDER = "openrouter" as const;
export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-oss-120b:free" as const;
export const OPENROUTER_MODEL_PRESETS = [
  "openai/gpt-oss-120b:free",
  "nvidia/nemotron-3-super-120b-a12b:free"
] as const;
export const DEFAULT_MAX_STEPS = 15;
export const DEFAULT_MAX_READ_BYTES = 200000;
export const DEFAULT_MAX_FILES = 500;
export const DEFAULT_COMMAND_TIMEOUT_MS = 30000;
export const DEFAULT_COMMAND_OUTPUT_BYTES = 100000;

export type ProviderName = "openrouter" | "openai";

export type AgentAction =
  | { type: "tool"; name: string; args: Record<string, unknown> }
  | { type: "final"; message: string };

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface SystemChatMessage {
  role: "system";
  content: string;
}

export interface UserChatMessage {
  role: "user";
  content: string;
}

export interface ChatToolCallFunction {
  name: string;
  arguments: string;
}

export interface ChatToolCall {
  id: string;
  type: "function";
  function: ChatToolCallFunction;
}

export interface AssistantChatMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: ChatToolCall[] | null;
  [key: string]: unknown;
}

export interface ToolChatMessage {
  role: "tool";
  content: string;
  tool_call_id: string;
  name?: string;
}

export type ChatMessage =
  | SystemChatMessage
  | UserChatMessage
  | AssistantChatMessage
  | ToolChatMessage;

export interface ChatToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type ChatToolChoice =
  | "none"
  | "auto"
  | "required"
  | {
      type: "function";
      function: {
        name: string;
      };
    };

export interface ModelRequest {
  messages: ChatMessage[];
  model: string;
  tools?: ChatToolDefinition[];
  toolChoice?: ChatToolChoice;
  parallelToolCalls?: boolean;
}

export interface ModelResponse {
  message: AssistantChatMessage;
  content: string | null;
  finishReason?: string | null;
  raw?: unknown;
  usage?: unknown;
}

export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface SessionHistoryEntry {
  role: "user" | "assistant" | "tool";
  content: string;
}

export interface Logger {
  step(message: string): void;
  debug(message: string): void;
  info(message: string): void;
  error(message: string): void;
}

export const silentLogger: Logger = {
  step() {},
  debug() {},
  info() {},
  error() {}
};
