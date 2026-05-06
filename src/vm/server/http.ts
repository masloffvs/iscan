import type { VmServerResponsePayload } from "./types";
import { RecoverableVmError } from "../../modules";

type ErrorWithCause = Error & { cause?: unknown };

export class VmServerHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
    if (cause !== undefined) {
      (this as ErrorWithCause).cause = cause;
    }
  }
}

export function buildErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return String(error);
}

export function createJsonResponse(payload: VmServerResponsePayload, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

export function createMethodNotAllowedResponse(allowedMethods: readonly string[]): Response {
  return createJsonResponse(
    {
      ok: false,
      error: `Method not allowed. Expected ${allowedMethods.join(" or ")}.`,
    },
    {
      status: 405,
      headers: {
        Allow: allowedMethods.join(", "),
      },
    },
  );
}

export function createErrorResponse(error: unknown): Response {
  if (error instanceof VmServerHttpError) {
    return createJsonResponse({ ok: false, error: error.message }, { status: error.status });
  }

  if (error instanceof RecoverableVmError) {
    return createJsonResponse({ ok: false, error: error.message }, { status: 400 });
  }

  return createJsonResponse(
    {
      ok: false,
      error: buildErrorMessage(error),
    },
    {
      status: 500,
    },
  );
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const rawBody = await request.text();
  if (rawBody.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch (error) {
    throw new VmServerHttpError(400, "Invalid JSON request body.", error);
  }
}

export function ensureRecordBody(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VmServerHttpError(400, "Request body must be a JSON object.");
  }

  return value as Record<string, unknown>;
}
