import { generateCode } from "genkode";

export const VM_CODE_LENGTH = 32;

const VM_CODE_PATTERN = new RegExp(`^[A-Za-z0-9]{${VM_CODE_LENGTH}}$`, "u");

export function generateVmCode(): string {
  return generateCode({
    length: VM_CODE_LENGTH,
    type: "alphanumeric",
    secure: true,
  });
}

export function isVmCode(value: string): boolean {
  return VM_CODE_PATTERN.test(value);
}