import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  Matches,
  type ValidationOptions,
} from 'class-validator';

export const TrimmedString = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export const NonBlankString = (
  fieldName: string,
  validationOptions?: ValidationOptions,
) =>
  applyDecorators(
    IsString(validationOptions),
    TrimmedString(),
    IsNotEmpty({ message: `${fieldName} should not be empty.` }),
    Matches(/\S/, { message: `${fieldName} should not be empty.` }),
  );
