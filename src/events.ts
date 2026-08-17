import { z } from "zod";

const baseFields = {
  agentId: z.string().min(1),
  tick: z.int().nonnegative(),
};

const memoryFields = {
  content: z.string().min(1),
  importance: z.int().min(1).max(10),
};

const storedFields = {
  sequence: z.int().positive(),
  createdAt: z.int().positive(),
};

const llmCallFields = {
  attempts: z.number().min(1).max(3).int("Value must be a whole number"),
  prompt: z.string().min(1),
  purpose: z.string().min(1),
};

const observationShape = {
  ...baseFields,
  ...memoryFields,
  type: z.literal("observation"),
};

const reflectionShape = {
  ...baseFields,
  ...memoryFields,
  type: z.literal("reflection"),
  pointerSequences: z.array(z.number().positive()).min(1),
};

const llmCallCompletedShape = {
  ...baseFields,
  ...llmCallFields,
  type: z.literal("llm_call_completed"),
  result: z.json(),
};

const llmCallFailedShape = {
  ...baseFields,
  ...llmCallFields,
  type: z.literal("llm_call_failed"),
  errors: z.array(z.string()).min(1),
};

export const agentEventSchema = z.discriminatedUnion("type", [
  z.strictObject(observationShape),
  z.strictObject(reflectionShape),
  z.strictObject(llmCallCompletedShape),
  z.strictObject(llmCallFailedShape),
]);

export const storedEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...observationShape, ...storedFields }),
  z.strictObject({ ...reflectionShape, ...storedFields }),
  z.strictObject({ ...llmCallCompletedShape, ...storedFields }),
  z.strictObject({ ...llmCallFailedShape, ...storedFields }),
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;
export type StoredEvent = z.infer<typeof storedEventSchema>;
