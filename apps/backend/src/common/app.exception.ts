import { HttpException } from '@nestjs/common';

/** A business error with a stable machine-readable code. */
export class AppException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: number,
    readonly details?: unknown,
  ) {
    super(message, status);
  }
}
