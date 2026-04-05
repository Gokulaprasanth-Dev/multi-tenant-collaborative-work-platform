export class AppError extends Error {
  public readonly details?: Record<string, unknown>;
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(400, code, message, details);
  }
}
export class UnauthorizedError extends AppError {
  constructor(code: string, message: string) { super(401, code, message); }
}
export class ForbiddenError extends AppError {
  constructor(code: string, message: string) { super(403, code, message); }
}
export class NotFoundError extends AppError {
  constructor(resource: string) { super(404, 'NOT_FOUND', `${resource} not found`); }
}
export class ConflictError extends AppError {
  constructor(code: string, message: string) { super(409, code, message); }
}
export class UnprocessableError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(422, code, message, details);
  }
}
export class TooManyRequestsError extends AppError {
  constructor(retryAfter?: number) {
    super(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests',
      retryAfter ? { retry_after: retryAfter } : undefined);
  }
}
export class ValidationError extends BadRequestError {
  constructor(details: Record<string, unknown>) {
    super('VALIDATION_ERROR', 'Input validation failed', details);
  }
}
