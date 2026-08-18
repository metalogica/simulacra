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

/**
 * Implementation Details:
 * - 0x6d2b79f5 (The Increment / Fractional Golden Ratio):
 *   - Guarantees a full period length of 2^32 (4.29 billion calls.
 * - OFFSET (1-3):
 *   - Used to eliminate statistical clustering on outputs.
 * - Normalization Range: [0 to 4294967295]
 */
function* crateMulberry32(seed: number): Generator {
  if (Number.isNaN(seed)) {
    throw new Error(
      "Mock LLM Client: received NaN instead of a integer seed value for mulberry 32 input",
    );
  }

  const NORMALIZATION_INTEGER = 4294967296;
  const OFFSET_1 = 15;
  const OFFSET_2 = 7;
  const OFFSET_3 = 14;

  let state = seed >>> 0;

  while (true) {
    state = (state + 0x6d2b79f5) | 0;

    let t = Math.imul(state ^ (state >>> OFFSET_1), 1 | state);

    t = (t + Math.imul(t ^ (t >>> OFFSET_2), 61 | t)) ^ t;

    yield ((t ^ (t >>> OFFSET_3)) >>> 0) / NORMALIZATION_INTEGER;
  }
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
  const mulberry32 = crateMulberry32(seed);

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

    const randomInt = mulberry32.next().value;
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
