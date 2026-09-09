import { mulberry32 } from "./prng.ts";

const DEFAULT_SEED = 1;
const DEFAULT_CHAOS_RATE = 0;
const DEFAULT_INVALID_OUTPUT = "{{{{{GARBLEDJSON" as string;

interface CallDetailRecord {
  purpose: string;
  prompt: string;
}

export interface LlmClient {
  complete: (input: CallDetailRecord) => Promise<string>;
}

export interface MockLLM extends LlmClient {
  calls: () => ReadonlyArray<CallDetailRecord>;
}

interface CreateMockLLMInput {
  responses: Record<string, string | string[]>;
  chaosRate?: number;
  seed?: number;
}

const createResponsePicker = (response: string | string[]): (() => string) => {
  if (typeof response === "string") {
    return () => response;
  }

  let index = 0;
  return () => {
    const value = response[index] ?? "";

    if (index < response.length - 1) {
      index += 1;
    }

    return value;
  };
};

export const createMockLLM = (input: CreateMockLLMInput): MockLLM => {
  const {
    responses,
    chaosRate = DEFAULT_CHAOS_RATE,
    seed = DEFAULT_SEED,
  } = input;

  const recordedCalls: CallDetailRecord[] = [];
  const generateRandomInt = mulberry32(seed);

  const pickers = new Map<string, () => string>();
  for (const [purpose, response] of Object.entries(responses)) {
    pickers.set(purpose, createResponsePicker(response));
  }

  const complete = async ({ prompt, purpose }: CallDetailRecord) => {
    const picker = pickers.get(purpose);

    if (!picker) {
      throw new Error(`Mock LLM: Received unknown purpose ${purpose}.`);
    }

    recordedCalls.push({ purpose, prompt });

    const randomInt = generateRandomInt();
    if (randomInt < chaosRate) {
      return DEFAULT_INVALID_OUTPUT;
    }

    return picker();
  };

  const calls = () => {
    return [...recordedCalls];
  };

  return {
    calls,
    complete,
  };
};
