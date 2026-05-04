import { Result } from "./result";

export class Adapter {
  constructor(private readonly response: string) {}

  as<T>(parserFn: (response: string) => T): Result<T> {
    try {
      const parsedData = parserFn(this.response);
      return Result.ok(parsedData);
    } catch (error) {
      return Result.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

export function adapter(response: string): Adapter {
  return new Adapter(response);
}
