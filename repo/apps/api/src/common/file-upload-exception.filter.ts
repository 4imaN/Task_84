import { ArgumentsHost, Catch, ExceptionFilter, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { MulterError } from 'multer';
import type { AppConfig } from '../config/app-config';
import type { RequestWithContext } from './http';

const formatFileSizeLimit = (bytes: number) => {
  const mebibytes = bytes / (1024 * 1024);
  return Number.isInteger(mebibytes) ? `${mebibytes} MiB` : `${mebibytes.toFixed(1)} MiB`;
};

@Catch(MulterError, PayloadTooLargeException)
export class FileUploadExceptionFilter implements ExceptionFilter {
  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  catch(exception: MulterError | PayloadTooLargeException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<RequestWithContext>();

    if (
      exception instanceof MulterError
        ? exception.code === 'LIMIT_FILE_SIZE'
        : exception.message === 'File too large'
    ) {
      const payload = new PayloadTooLargeException(
        `Evidence files must be ${formatFileSizeLimit(
          this.configService.get('evidenceUploadMaxBytes', { infer: true }),
        )} or smaller.`,
      ).getResponse();

      response.status(413).json({
        ...(typeof payload === 'string' ? { message: payload } : payload),
        traceId: request.traceId,
      });
      return;
    }

    response.status(400).json({
      statusCode: 400,
      message: exception.message,
      error: 'Bad Request',
      traceId: request.traceId,
    });
  }
}
