// frontend/src/app/core/models/api-response.model.ts
export interface ApiMeta {
  correlationId: string;
  requestId: string;
  timestamp: string;
}

export interface ApiError {
  code: string;
  message: string;
}

export interface ApiResponse<T> {
  data: T;
  error: ApiError | null;
  meta: ApiMeta;
}

// Typed error thrown by ErrorInterceptor
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
