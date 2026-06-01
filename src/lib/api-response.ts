/**
 * DomainError-to-HTTP-response mapping (Task 15.4).
 *
 * Maps each DomainError category to its HTTP status code and a UI-safe,
 * PII-free message indicating whether the operation took effect.
 *
 * Requirements:
 * - 22.1: Error responses indicate whether the operation took effect
 * - 22.2: Each DomainError category maps to a distinct HTTP status
 * - 21.3: Exclude PII from operational logs
 * - 21.4: Exclude PII from cross-member messages
 *
 * Category → HTTP status mapping:
 * - validation → 422 (Unprocessable Entity)
 * - authorization → 403 (Forbidden)
 * - not_found → 404 (Not Found)
 * - referential_integrity → 409 (Conflict)
 * - invariant → 422 (Unprocessable Entity)
 * - conflict_exhausted → 503 (Service Unavailable)
 * - unavailable → 503 (Service Unavailable)
 */

import type { DomainError, DomainErrorCategory } from "@/domain/result";
import { stripPii } from "./logger";

// ─── Status Code Mapping ─────────────────────────────────────────────────────

const CATEGORY_TO_STATUS: Record<DomainErrorCategory, number> = {
  validation: 422,
  authorization: 403,
  not_found: 404,
  referential_integrity: 409,
  invariant: 422,
  conflict_exhausted: 503,
  unavailable: 503,
};

/**
 * Whether the operation took effect for each error category.
 * This helps the UI decide whether to retry or show a definitive failure.
 */
const CATEGORY_TOOK_EFFECT: Record<DomainErrorCategory, boolean> = {
  validation: false,
  authorization: false,
  not_found: false,
  referential_integrity: false,
  invariant: false,
  conflict_exhausted: false,
  unavailable: false,
};

// ─── Response Types ──────────────────────────────────────────────────────────

export interface ApiErrorBody {
  category: DomainErrorCategory;
  message: string;
  field?: string;
  operationTookEffect: boolean;
  maxSettleableMinor?: number;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
}

export interface MappedResponse {
  status: number;
  body: ApiErrorResponse;
}

// ─── Mapping Function ────────────────────────────────────────────────────────

/**
 * Map a DomainError to an HTTP response with status code and PII-free body.
 *
 * The message is stripped of any PII (email addresses) before being included
 * in the response body (Req 21.4).
 */
export function mapDomainErrorToResponse(error: DomainError): MappedResponse {
  const status = CATEGORY_TO_STATUS[error.category];
  const operationTookEffect = CATEGORY_TOOK_EFFECT[error.category];

  // Strip PII from the message before including in the response
  const safeMessage = stripPii(error.message);

  const body: ApiErrorResponse = {
    error: {
      category: error.category,
      message: safeMessage,
      operationTookEffect,
    },
  };

  // Include field if present (for validation errors)
  if (error.field !== undefined) {
    body.error.field = error.field;
  }

  // Include maxSettleableMinor if present (for INV-5 rejections)
  if (error.maxSettleableMinor !== undefined) {
    body.error.maxSettleableMinor = error.maxSettleableMinor;
  }

  return { status, body };
}

/**
 * Create a success response body.
 */
export function apiSuccess<T>(data: T): { data: T } {
  return { data };
}
