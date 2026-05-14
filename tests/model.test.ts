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
      content: '{"type":"tool","name":"list_files","args":{}}'
    });
    await expect(model.complete({ model: "fake", messages: [] })).resolves.toEqual({
      content: '{"type":"final","message":"Done."}'
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
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"type":"final","message":"ok"}' } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
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
});
