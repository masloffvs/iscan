function extractErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.length > 0) {
		return error.message;
	}

	return String(error);
}

type ErrorWithCause = Error & { cause?: unknown };

export class ModulePromptError extends Error {
	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = new.target.name;
		if (cause !== undefined) {
			(this as ErrorWithCause).cause = cause;
		}
	}
}

export class UnknownModuleError extends ModulePromptError {
	readonly moduleId: string;

	constructor(moduleId: string) {
		super(`Unknown module: ${moduleId}`);
		this.moduleId = moduleId;
	}
}

export class InvalidParamsError extends ModulePromptError {
	constructor(message: string, cause?: unknown) {
		super(message, cause);
	}
}

export class EvalRuntimeError extends ModulePromptError {
	readonly input: string;

	constructor(input: string, cause: unknown) {
		super(EvalRuntimeError.buildMessage(cause), cause);
		this.input = input;
	}

	private static buildMessage(cause: unknown): string {
		if (cause instanceof ReferenceError) {
			const match = cause.message.match(/^(.*?) is not defined$/u);
			if (match?.[1]) {
				return `Unknown symbol or command: ${match[1]}`;
			}
		}

		if (cause instanceof SyntaxError) {
			return `Invalid JavaScript input: ${cause.message}`;
		}

		return `Evaluation failed: ${extractErrorMessage(cause)}`;
	}
}

export function isModulePromptError(error: unknown): error is ModulePromptError {
	return error instanceof ModulePromptError;
}