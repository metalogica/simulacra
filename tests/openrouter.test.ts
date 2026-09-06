/**
 * Contract for `src/openrouter.ts` — both ports over an injected fetch.
 * Rep 8 of M2. Depends on nothing but the port types.
 *
 * No test here reaches the network. `fetch` is a fake that records the
 * request and returns a canned Response; a fresh Response per call, because
 * a body can only be read once.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPENROUTER_BASE_URL,
  createOpenRouterClients,
} from "../src/openrouter.ts";

interface Captured {
  url: string;
  init: RequestInit | undefined;
}

const fakeFetch = (reply: () => Response) => {
  const captured: Captured[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(input), init });
    return reply();
  }) as typeof globalThis.fetch;
  return { fetch, captured };
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const API_KEY = "sk-or-test-secret-do-not-leak";

const clients = (reply: () => Response, baseUrl?: string) => {
  const { fetch, captured } = fakeFetch(reply);
  const created = createOpenRouterClients({
    apiKey: API_KEY,
    chatModel: "anthropic/claude-sonnet-5",
    embeddingModel: "openai/text-embedding-3-small",
    fetch,
    ...(baseUrl === undefined ? {} : { baseUrl }),
  });
  return { ...created, captured };
};

const bodyOf = (captured: Captured): Record<string, unknown> =>
  JSON.parse(String(captured.init?.body)) as Record<string, unknown>;

const headersOf = (captured: Captured): Headers =>
  new Headers(captured.init?.headers);

const CHAT_OK = {
  id: "gen-1",
  choices: [{ message: { role: "assistant", content: '{"thought":"hi"}' } }],
};

const EMBED_OK = {
  data: [{ embedding: [0.6, 0.8], index: 0 }],
  model: "openai/text-embedding-3-small",
};

describe("llm.complete — request shape", () => {
  it("posts to /chat/completions under the default base URL", async () => {
    const { llm, captured } = clients(() => json(CHAT_OK));
    await llm.complete({ purpose: "p", prompt: "hello" });
    expect(captured[0]!.url).toBe(
      `${DEFAULT_OPENROUTER_BASE_URL}/chat/completions`,
    );
    expect(captured[0]!.init?.method).toBe("POST");
  });

  it("honours a custom base URL", async () => {
    const { llm, captured } = clients(() => json(CHAT_OK), "http://localhost:9999/v1");
    await llm.complete({ purpose: "p", prompt: "hello" });
    expect(captured[0]!.url).toBe("http://localhost:9999/v1/chat/completions");
  });

  it("sends bearer auth and a JSON content type", async () => {
    const { llm, captured } = clients(() => json(CHAT_OK));
    await llm.complete({ purpose: "p", prompt: "hello" });
    const headers = headersOf(captured[0]!);
    expect(headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(headers.get("content-type")).toMatch(/application\/json/);
  });

  it("sends the model, temperature 0, and the prompt as one user message", async () => {
    const { llm, captured } = clients(() => json(CHAT_OK));
    await llm.complete({ purpose: "p", prompt: "What does maria notice?" });
    const body = bodyOf(captured[0]!);
    expect(body["model"]).toBe("anthropic/claude-sonnet-5");
    expect(body["temperature"]).toBe(0);
    expect(body["messages"]).toEqual([
      { role: "user", content: "What does maria notice?" },
    ]);
  });

  it("makes exactly one request per call", async () => {
    const { llm, captured } = clients(() => json(CHAT_OK));
    await llm.complete({ purpose: "p", prompt: "hello" });
    expect(captured).toHaveLength(1);
  });
});

describe("llm.complete — response handling", () => {
  it("returns the assistant content as a string", async () => {
    const { llm } = clients(() => json(CHAT_OK));
    await expect(llm.complete({ purpose: "p", prompt: "hello" })).resolves.toBe(
      '{"thought":"hi"}',
    );
  });

  it("throws on a non-2xx status", async () => {
    const { llm } = clients(() => json({ error: { message: "boom" } }, 500));
    await expect(llm.complete({ purpose: "p", prompt: "hello" })).rejects.toThrow();
  });

  it("throws on a 200 that carries an error member", async () => {
    // OpenRouter reports upstream failures inside a 200 body.
    const { llm } = clients(() =>
      json({ error: { message: "upstream provider unavailable", code: 502 } }),
    );
    await expect(llm.complete({ purpose: "p", prompt: "hello" })).rejects.toThrow();
  });

  it("throws when choices are missing", async () => {
    const { llm } = clients(() => json({ id: "gen-1" }));
    await expect(llm.complete({ purpose: "p", prompt: "hello" })).rejects.toThrow();
  });

  it("throws when content is not a string", async () => {
    const { llm } = clients(() =>
      json({ choices: [{ message: { role: "assistant", content: null } }] }),
    );
    await expect(llm.complete({ purpose: "p", prompt: "hello" })).rejects.toThrow();
  });

  it("throws when the body is not JSON", async () => {
    const { llm } = clients(() => new Response("<html>gateway timeout</html>", { status: 200 }));
    await expect(llm.complete({ purpose: "p", prompt: "hello" })).rejects.toThrow();
  });

  it("never puts the api key in an error message", async () => {
    for (const reply of [
      () => json({ error: { message: "boom" } }, 401),
      () => json({ error: { message: "boom" } }),
      () => json({}),
    ]) {
      const { llm } = clients(reply);
      const error = await llm
        .complete({ purpose: "p", prompt: "hello" })
        .then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(API_KEY);
    }
  });
});

describe("embeddings.embed — request shape", () => {
  it("posts to /embeddings with the model and the text as input", async () => {
    const { embeddings, captured } = clients(() => json(EMBED_OK));
    await embeddings.embed({ purpose: "p", text: "Klaus is reading" });
    expect(captured[0]!.url).toBe(`${DEFAULT_OPENROUTER_BASE_URL}/embeddings`);
    expect(captured[0]!.init?.method).toBe("POST");
    const body = bodyOf(captured[0]!);
    expect(body["model"]).toBe("openai/text-embedding-3-small");
    expect(body["input"]).toBe("Klaus is reading");
  });

  it("sends bearer auth", async () => {
    const { embeddings, captured } = clients(() => json(EMBED_OK));
    await embeddings.embed({ purpose: "p", text: "x" });
    expect(headersOf(captured[0]!).get("authorization")).toBe(`Bearer ${API_KEY}`);
  });
});

describe("embeddings.embed — response handling", () => {
  it("returns the vector and the configured model", async () => {
    const { embeddings } = clients(() => json(EMBED_OK));
    await expect(embeddings.embed({ purpose: "p", text: "x" })).resolves.toEqual({
      vector: [0.6, 0.8],
      model: "openai/text-embedding-3-small",
    });
  });

  it("throws on a non-2xx status", async () => {
    const { embeddings } = clients(() => json({ error: { message: "boom" } }, 429));
    await expect(embeddings.embed({ purpose: "p", text: "x" })).rejects.toThrow();
  });

  it("throws on a 200 that carries an error member", async () => {
    const { embeddings } = clients(() => json({ error: { message: "boom" } }));
    await expect(embeddings.embed({ purpose: "p", text: "x" })).rejects.toThrow();
  });

  it("throws when data is missing", async () => {
    const { embeddings } = clients(() => json({ model: "x" }));
    await expect(embeddings.embed({ purpose: "p", text: "x" })).rejects.toThrow();
  });

  it("throws when an element is not a finite number", async () => {
    const { embeddings } = clients(() =>
      json({ data: [{ embedding: [0.1, "0.2"] }] }),
    );
    await expect(embeddings.embed({ purpose: "p", text: "x" })).rejects.toThrow();
  });

  it("throws on an empty vector", async () => {
    const { embeddings } = clients(() => json({ data: [{ embedding: [] }] }));
    await expect(embeddings.embed({ purpose: "p", text: "x" })).rejects.toThrow();
  });

  it("never puts the api key in an error message", async () => {
    const { embeddings } = clients(() => json({ error: { message: "boom" } }, 401));
    const error = await embeddings
      .embed({ purpose: "p", text: "x" })
      .then(() => null, (e: unknown) => e);
    expect((error as Error).message).not.toContain(API_KEY);
  });
});
