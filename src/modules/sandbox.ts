export type ModuleSandboxEnvironment = Record<string, unknown>;

export type ModuleSandboxOptions = {
	environment?: ModuleSandboxEnvironment;
};

type AsyncFunctionConstructor = new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;
const AsyncFunction = (async () => {}).constructor as AsyncFunctionConstructor;

function isSyntaxError(error: unknown): boolean {
	return error instanceof SyntaxError;
}

export class ModuleSandbox {
	private environment: ModuleSandboxEnvironment;

	constructor(options: ModuleSandboxOptions = {}) {
		this.environment = { ...(options.environment ?? {}) };
	}

	getEnvironment(): ModuleSandboxEnvironment {
		return { ...this.environment };
	}

	setEnvironment(environment: ModuleSandboxEnvironment): void {
		this.environment = { ...environment };
	}

	extendEnvironment(environment: ModuleSandboxEnvironment): void {
		this.environment = {
			...this.environment,
			...environment,
		};
	}

	async execute(code: string, context: ModuleSandboxEnvironment): Promise<unknown> {
		const scope = {
			...this.environment,
			...context,
		};
		const names = Object.keys(scope);
		const values = Object.values(scope);

		try {
			const expressionFunction = new AsyncFunction(...names, `"use strict"; return await (${code});`);
			return await expressionFunction(...values);
		} catch (error) {
			if (!isSyntaxError(error)) {
				throw error;
			}

			const statementFunction = new AsyncFunction(...names, `"use strict"; ${code}`);
			return await statementFunction(...values);
		}
	}
}