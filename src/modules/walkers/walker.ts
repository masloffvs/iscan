import { Result } from "../adapters/result";

export abstract class Walker<TData, TParams, TResult> {
  constructor(protected readonly data: TData) {}

  abstract run(params: TParams): Promise<Result<TResult>> | Result<TResult>;
}
