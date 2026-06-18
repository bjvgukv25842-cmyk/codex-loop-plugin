export interface ValidationErrorDetail {
  schemaName: string;
  path: string;
  message: string;
  keyword?: string;
}

export class SchemaValidationError extends Error {
  readonly schemaName: string;
  readonly details: ValidationErrorDetail[];

  constructor(schemaName: string, details: ValidationErrorDetail[]) {
    const message = details.length
      ? `${schemaName} validation failed: ${details[0]?.message}`
      : `${schemaName} validation failed`;

    super(message);
    this.name = "SchemaValidationError";
    this.schemaName = schemaName;
    this.details = details;
  }
}
