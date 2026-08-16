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

const observationShape = {
  ...baseFields,
  ...memoryFields,
  type: z.literal("observation"),
};

const reflectionShape = {
  ...baseFields,
  ...memoryFields,
  type: z.literal("reflection"),
  pointerSequences: z.array(z.int().positive()).min(1),
};

export const agentEventSchema = z.discriminatedUnion("type", [
  z.strictObject(observationShape),
  z.strictObject(reflectionShape),
]);

export const storedEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...observationShape, ...storedFields }),
  z.strictObject({ ...reflectionShape, ...storedFields }),
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;
export type StoredEvent = z.infer<typeof storedEventSchema>;
