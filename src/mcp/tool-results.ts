export type McpStoreErrorCode = "invalid_input" | "not_found" | "store_error" | "unknown_tool";

export interface McpStoreError {
  code: McpStoreErrorCode;
  message: string;
  id?: string;
  details?: unknown;
}

export interface McpWriteResult {
  ok: true;
  status: "created" | "updated" | "appended";
  id: string;
  event_id: string;
}

export interface McpReadResult<T = unknown> {
  ok: true;
  item: T;
}

export interface McpListResult<T = unknown> {
  ok: true;
  items: T[];
}

export interface McpErrorResult {
  ok: false;
  error: McpStoreError;
}

export type McpToolResult<T = unknown> = McpWriteResult | McpReadResult<T> | McpListResult<T> | McpErrorResult;

export const MCP_TOOL_RESULT_SCHEMA = {
  type: "object",
  required: ["ok"],
  properties: {
    ok: {
      type: "boolean"
    },
    status: {
      type: "string",
      enum: ["created", "updated", "appended"]
    },
    id: {
      type: "string"
    },
    event_id: {
      type: "string"
    },
    item: {},
    items: {
      type: "array",
      items: {}
    },
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: {
          type: "string",
          enum: ["invalid_input", "not_found", "store_error", "unknown_tool"]
        },
        message: {
          type: "string"
        },
        id: {
          type: "string"
        },
        details: {}
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
} as const;

export function writeResult(status: McpWriteResult["status"], id: string, eventId: string): McpWriteResult {
  return {
    ok: true,
    status,
    id,
    event_id: eventId
  };
}

export function readResult<T>(item: T): McpReadResult<T> {
  return {
    ok: true,
    item
  };
}

export function listResult<T>(items: T[]): McpListResult<T> {
  return {
    ok: true,
    items
  };
}

export function errorResult(error: McpStoreError): McpErrorResult {
  return {
    ok: false,
    error
  };
}
