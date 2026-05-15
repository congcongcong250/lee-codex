import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatMessage, ProviderName } from "./types.js";

export type ConversationLogStatus =
  | "running"
  | "success"
  | "failed"
  | "incomplete";

export interface ConversationLogEvent {
  type: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface ConversationRecorder {
  recordMessages(messages: ChatMessage[]): Promise<void>;
  recordEvent(event: ConversationLogEvent): Promise<void>;
  finish(status: ConversationLogStatus, error?: string): Promise<void>;
}

export interface CreateConversationLogOptions {
  logDir: string;
  provider: ProviderName;
  model: string;
  cwd: string;
}

interface ConversationLogEnvelope {
  version: 1;
  startedAt: string;
  updatedAt: string;
  status: ConversationLogStatus;
  provider: ProviderName;
  model: string;
  cwd: string;
  messages: ChatMessage[];
  events: Required<ConversationLogEvent>[];
  error?: string;
}

export class JsonConversationLog implements ConversationRecorder {
  private readonly envelope: ConversationLogEnvelope;

  private constructor(
    readonly filePath: string,
    options: CreateConversationLogOptions,
    now: string
  ) {
    this.envelope = {
      version: 1,
      startedAt: now,
      updatedAt: now,
      status: "running",
      provider: options.provider,
      model: options.model,
      cwd: options.cwd,
      messages: [],
      events: []
    };
  }

  static async create(
    options: CreateConversationLogOptions
  ): Promise<JsonConversationLog> {
    await mkdir(options.logDir, { recursive: true });
    const now = new Date().toISOString();
    const filename = `lee-codex-${safeTimestamp(now)}-${randomUUID()}.json`;
    const log = new JsonConversationLog(
      path.join(options.logDir, filename),
      options,
      now
    );
    await log.persist(now);
    return log;
  }

  async recordMessages(messages: ChatMessage[]): Promise<void> {
    const now = new Date().toISOString();
    this.envelope.messages = cloneJson(messages);
    await this.persist(now);
  }

  async recordEvent(event: ConversationLogEvent): Promise<void> {
    const now = new Date().toISOString();
    this.envelope.events.push({
      ...cloneJson(event),
      timestamp: event.timestamp ?? now
    });
    await this.persist(now);
  }

  async finish(status: ConversationLogStatus, error?: string): Promise<void> {
    const now = new Date().toISOString();
    this.envelope.status = status;
    if (error !== undefined) {
      this.envelope.error = error;
    }
    this.envelope.events.push({
      type: "status",
      status,
      ...(error !== undefined ? { error } : {}),
      timestamp: now
    });
    await this.persist(now);
  }

  private async persist(now: string): Promise<void> {
    this.envelope.updatedAt = now;
    await writeFile(
      this.filePath,
      `${JSON.stringify(this.envelope, null, 2)}\n`,
      "utf8"
    );
  }
}

export function createConversationLog(
  options: CreateConversationLogOptions
): Promise<JsonConversationLog> {
  return JsonConversationLog.create(options);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}
