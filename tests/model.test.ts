import { describe, expect, test, vi } from "vitest";
import {
  createModelClient,
  FakeModelClient,
  getProviderConfig,
  OPENAI_COMPATIBLE_PROVIDERS
} from "../src/model.js";
import { OpenAICompatibleClient } from "../src/providers/openaiCompatible.js";

describe("provider config", () => {
  test("defaults to OpenRouter with the documented free model", () => {
    const config = getProviderConfig({
      env: { OPENROUTER_API_KEY: "router-key" }
    });

    expect(config).toMatchObject({
      provider: "openrouter",
      model: "openai/gpt-oss-120b:free",
      apiKey: "router-key",
      baseURL: "https://openrouter.ai/api/v1"
    });
  });

  test("documents OpenRouter presets without enforcing a model allowlist", () => {
    expect(OPENAI_COMPATIBLE_PROVIDERS.openrouter.modelPresets).toEqual([
      "openai/gpt-oss-120b:free",
      "nvidia/nemotron-3-super-120b-a12b:free"
    ]);

    const config = getProviderConfig({
      provider: "openrouter",
      model: "custom/provider-model",
      env: { OPENROUTER_API_KEY: "router-key" }
    });

    expect(config.model).toBe("custom/provider-model");
  });

  test("OpenAI provider reads OPENAI_API_KEY", () => {
    const config = getProviderConfig({
      provider: "openai",
      model: "gpt-test",
      env: { OPENAI_API_KEY: "openai-key" }
    });

    expect(config).toMatchObject({
      provider: "openai",
      model: "gpt-test",
      apiKey: "openai-key",
      baseURL: "https://api.openai.com/v1"
    });
  });

  test("missing provider API key fails clearly", () => {
    expect(() =>
      getProviderConfig({ provider: "openrouter", env: {} })
    ).toThrow(/OPENROUTER_API_KEY/);
  });
});

describe("FakeModelClient", () => {
  test("returns responses in sequence", async () => {
    const model = new FakeModelClient([
      '{"type":"tool","name":"list_files","args":{}}',
      '{"type":"final","message":"Done."}'
    ]);

    await expect(model.complete({ model: "fake", messages: [] })).resolves.toEqual({
      content: '{"type":"tool","name":"list_files","args":{}}',
      message: {
        role: "assistant",
        content: '{"type":"tool","name":"list_files","args":{}}'
      }
    });
    await expect(model.complete({ model: "fake", messages: [] })).resolves.toEqual({
      content: '{"type":"final","message":"Done."}',
      message: {
        role: "assistant",
        content: '{"type":"final","message":"Done."}'
      }
    });
  });

  test("fails when no fake responses remain", async () => {
    const model = new FakeModelClient([]);

    await expect(model.complete({ model: "fake", messages: [] })).rejects.toThrow(
      /No fake model responses remain/
    );
  });
});

describe("OpenAICompatibleClient", () => {
  test("sends non-streaming chat completions requests", async () => {
    const fetchImpl = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: '{"type":"final","message":"ok"}'
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
      }
    );
    const client = new OpenAICompatibleClient({
      apiKey: "key",
      baseURL: "https://example.test/v1",
      fetchImpl
    });

    const response = await client.complete({
      model: "model-id",
      messages: [{ role: "user", content: "hi" }]
    });

    expect(response.content).toBe('{"type":"final","message":"ok"}');
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.test/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer key",
          "content-type": "application/json"
        }),
        body: JSON.stringify({
          model: "model-id",
          messages: [{ role: "user", content: "hi" }],
          stream: false
        })
      })
    );
  });

  test("sends native tool calling fields when tools are provided", async () => {
    const calls: RequestInit[] = [];
    const fetchImpl = (async (
      _input: Parameters<typeof fetch>[0],
      init?: RequestInit
    ) => {
      calls.push(init ?? {});
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;
    const client = new OpenAICompatibleClient({
      apiKey: "key",
      baseURL: "https://example.test/v1",
      fetchImpl
    });

    await client.complete({
      model: "model-id",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read a file",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
              additionalProperties: false
            }
          }
        }
      ],
      toolChoice: "auto",
      parallelToolCalls: false
    });

    const init = calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false
          }
        }
      }
    ]);
    expect(body.tool_choice).toBe("auto");
    expect(body.parallel_tool_calls).toBe(false);
  });

  test("returns full assistant message and finish reason", async () => {
    const rawResponse = {
      id: "chatcmpl-test",
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_123",
                type: "function",
                function: {
                  name: "read_file",
                  arguments: "{\"path\":\"README.md\"}"
                }
              }
            ]
          }
        }
      ],
      usage: { total_tokens: 10 }
    };
    const client = new OpenAICompatibleClient({
      apiKey: "key",
      baseURL: "https://example.test/v1",
      fetchImpl: async () =>
        new Response(JSON.stringify(rawResponse), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    });

    await expect(
      client.complete({ model: "model-id", messages: [] })
    ).resolves.toMatchObject({
      message: rawResponse.choices[0]?.message,
      content: null,
      finishReason: "tool_calls",
      raw: rawResponse,
      usage: rawResponse.usage
    });
  });

  test("merges provider extra body into chat completion requests", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: '{"type":"final","message":"ok"}'
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const client = new OpenAICompatibleClient({
      apiKey: "key",
      baseURL: "https://example.test/v1",
      fetchImpl,
      extraBody: {
        reasoning: {
          effort: "none",
          exclude: true
        }
      }
    });

    await client.complete({
      model: "model-id",
      messages: [{ role: "user", content: "hi" }]
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.test/v1/chat/completions",
      expect.objectContaining({
        body: JSON.stringify({
          model: "model-id",
          messages: [{ role: "user", content: "hi" }],
          stream: false,
          reasoning: {
            effort: "none",
            exclude: true
          }
        })
      })
    );
  });

  test("concatenates provider text content parts", async () => {
    const client = new OpenAICompatibleClient({
      apiKey: "key",
      baseURL: "https://example.test/v1",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: [
                    { type: "text", text: '{"type":"final",' },
                    { type: "text", text: '"message":"ok"}' }
                  ]
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });

    await expect(
      client.complete({ model: "model-id", messages: [] })
    ).resolves.toMatchObject({
      content: '{"type":"final","message":"ok"}'
    });
  });

  test("preserves null provider message content", async () => {
    const client = new OpenAICompatibleClient({
      apiKey: "key",
      baseURL: "https://example.test/v1",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  reasoning: "thinking"
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });

    await expect(
      client.complete({ model: "model-id", messages: [] })
    ).resolves.toMatchObject({
      content: null,
      message: {
        role: "assistant",
        content: null
      }
    });
  });

  test("surfaces provider errors", async () => {
    const client = new OpenAICompatibleClient({
      apiKey: "key",
      baseURL: "https://example.test/v1",
      fetchImpl: async () => new Response("bad", { status: 429 })
    });

    await expect(
      client.complete({ model: "model-id", messages: [] })
    ).rejects.toThrow(/Provider request failed with status 429: bad/);
  });
});

describe("createModelClient", () => {
  test("creates an OpenAI-compatible client from config", () => {
    const client = createModelClient({
      provider: "openrouter",
      env: { OPENROUTER_API_KEY: "router-key" }
    });

    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });

  test("OpenRouter client requires native parameters without disabling reasoning", async () => {
    const calls: RequestInit[] = [];
    const fetchImpl = (async (
      _input: Parameters<typeof fetch>[0],
      init?: RequestInit
    ) => {
      calls.push(init ?? {});
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: '{"type":"final","message":"ok"}'
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;
    const config = getProviderConfig({
      provider: "openrouter",
      env: { OPENROUTER_API_KEY: "router-key" }
    });
    const client = createModelClient(
      { provider: "openrouter", env: { OPENROUTER_API_KEY: "router-key" } },
      { fetchImpl }
    );

    await client.complete({
      model: config.model,
      messages: [],
      tools: [
        {
          type: "function",
          function: {
            name: "list_files",
            description: "List files",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false
            }
          }
        }
      ],
      toolChoice: "auto",
      parallelToolCalls: false
    });

    const init = calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.tools).toHaveLength(1);
    expect(body.tool_choice).toBe("auto");
    expect(body).not.toHaveProperty("parallel_tool_calls");
    expect(body).not.toHaveProperty("reasoning");
    expect(body.provider).toEqual({
      require_parameters: true
    });
  });

  test("OpenAI client keeps explicit parallel tool call control", async () => {
    const calls: RequestInit[] = [];
    const fetchImpl = (async (
      _input: Parameters<typeof fetch>[0],
      init?: RequestInit
    ) => {
      calls.push(init ?? {});
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;
    const config = getProviderConfig({
      provider: "openai",
      model: "gpt-test",
      env: { OPENAI_API_KEY: "openai-key" }
    });
    const client = createModelClient(
      {
        provider: "openai",
        model: "gpt-test",
        env: { OPENAI_API_KEY: "openai-key" }
      },
      { fetchImpl }
    );

    await client.complete({
      model: config.model,
      messages: [],
      tools: [
        {
          type: "function",
          function: {
            name: "list_files",
            description: "List files",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false
            }
          }
        }
      ],
      toolChoice: "auto",
      parallelToolCalls: false
    });

    const init = calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.parallel_tool_calls).toBe(false);
    expect(body.provider).toBeUndefined();
  });
});
