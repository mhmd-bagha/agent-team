/** Structured Jev errors. `details` never carries secrets (enforced by callers). */
export type JevErrorCode =
  | "DISABLED"
  | "NOT_CONFIGURED"
  | "TIMEOUT"
  | "NETWORK"
  | "AUTH"
  | "BAD_RESPONSE"
  | "INVALID_DECISION"
  | "LOW_CONFIDENCE";

export class JevError extends Error {
  readonly code: JevErrorCode;
  readonly retryable: boolean;

  constructor(code: JevErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "JevError";
    this.code = code;
    this.retryable = retryable;
  }
}
