// Result<T> helpers shared across the app.
import type { AppError, Result } from "./ipc-types.ts";

export function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

export function err<T>(message: string, extras: Partial<AppError> = {}): Result<T> {
  return { success: false, error: { message, ...extras } };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}