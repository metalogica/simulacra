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
    sum += a[i] * b[i];
  }

  return sum;
};

export const norm = (a: Float32Array): number => todo(a);

export const normalize = (a: Float32Array): Float32Array => todo(a);

export const centre = (a: Float32Array): Float32Array => todo(a);

export const cosineSimilarity = (a: Float32Array, b: Float32Array): number =>
  todo(a, b);
