/**
 * Vector arithmetic over Float32Array.
 *
 * @module
 * Contract:
 * - Every function is pure. Inputs are never mutated; results are new arrays.
 * - `dot` and `cosineSimilarity` throw when the lengths differ.
 * - `normalize` throws on the zero vector — there is no direction to keep.
 * - `centre` subtracts the arithmetic mean from every element.
 * - `cosineSimilarity(a, b)` = dot(a, b) / (norm(a) · norm(b)); throws when
 *   either norm is 0.
 */
import { todo } from "./todo.ts";

export const dot = (a: Float32Array, b: Float32Array): number => {
  let sum = 0;

  if (a.length !== b.length) {
    throw new Error("Input vectors are not the same length.");
  }

  for (let i = 0; i < b.length; i += 1) {
    sum += a[i]! * b[i]!;
  }

  return sum;
};

export const norm = (v: Float32Array): number => {
  let sum = 0;

  for (const i of v) {
    sum += i ** 2;
  }

  return Math.sqrt(sum);
};

export const normalize = (a: Float32Array): Float32Array => {
  const magnitude = norm(a);

  if (magnitude == 0) {
    throw new Error("Cannot normalize a 0-dimensional vector");
  }

  const normalized = new Float32Array(a.length);

  for (let i = 0; i < a.length; i += 1) {
    normalized[i] = a[i]! / magnitude;
  }

  return normalized;
};

export const centre = (v1: Float32Array): Float32Array => {
  const sum = v1.reduce((sum, value) => (sum += value), 0);

  const mean = sum / v1.length;

  const v2 = new Float32Array(v1.length);
  for (let i = 0; i < v2.length; i++) {
    v2[i] = v1[i]! - mean;
  }

  return v2;
};

export const cosineSimilarity = (a: Float32Array, b: Float32Array): number =>
  todo(a, b);
