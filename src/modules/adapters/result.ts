export class Result<T, E = Error> {
  private constructor(
    public readonly isSuccess: boolean,
    public readonly value?: T,
    public readonly error?: E
  ) {}

  static ok<T>(value: T): Result<T, never> {
    return new Result<T, never>(true, value, undefined);
  }

  static fail<E>(error: E): Result<never, E> {
    return new Result<never, E>(false, undefined, error);
  }

  unwrap(): T {
    if (!this.isSuccess) {
      throw this.error;
    }
    return this.value as T;
  }

  isEmpty(): boolean {
    if (!this.isSuccess) {
      return true;
    }
    if (Array.isArray(this.value)) {
      return this.value.length === 0;
    }
    if (this.value === null || this.value === undefined) {
      return true;
    }
    return false;
  }

  getError(): E | undefined {
    return this.error;
  }
}
