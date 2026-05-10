import { EventEmitter } from "node:events";

import { describe, expect, test } from "bun:test";

import type { ResolvedPortScanServiceConfig } from "../config";
import { assertPortScanTargetAllowed, checkPort } from "./port-scan-kit";

const BASE_POLICY: ResolvedPortScanServiceConfig = {
	allowHosts: [],
	denyHosts: [],
	allowPrivateAddresses: true,
	allowLoopback: true,
	denyPublicAddresses: true,
};

class FakePortProbeSocket extends EventEmitter {
	public destroyCalls = 0;
	public endCalls = 0;

	destroy(_error?: Error): this {
		this.destroyCalls += 1;
		return this;
	}

	end(): this {
		this.endCalls += 1;
		return this;
	}
}

describe("assertPortScanTargetAllowed", () => {
	test("keeps wildcard host allow entries working for unresolved targets", async () => {
		await expect(
			assertPortScanTargetAllowed("definitely-does-not-resolve.invalid", {
				...BASE_POLICY,
				allowHosts: ["*"],
			}),
		).resolves.toBeUndefined();
	});

	test("allows localhost when a CIDR allow entry matches the resolved address", async () => {
		await expect(
			assertPortScanTargetAllowed("localhost", {
				...BASE_POLICY,
				allowHosts: ["127.0.0.0/8"],
				allowLoopback: false,
			}),
		).resolves.toBeUndefined();
	});

	test("blocks localhost when a CIDR deny entry matches even if wildcard allow is present", async () => {
		await expect(
			assertPortScanTargetAllowed("localhost", {
				...BASE_POLICY,
				allowHosts: ["*"],
				denyHosts: ["127.0.0.0/8"],
			}),
		).rejects.toThrow("DENY_HOSTS entry '127.0.0.0/8'");
	});
});

describe("checkPort", () => {
	test("returns the probed port when the socket connects", async () => {
		const fakeSocket = new FakePortProbeSocket();
		queueMicrotask(() => {
			fakeSocket.emit("connect");
		});

		await expect(
			checkPort("127.0.0.1", 443, 50, () => fakeSocket as any),
		).resolves.toBe(443);
		expect(fakeSocket.endCalls).toBe(1);
		expect(fakeSocket.destroyCalls).toBe(0);
	});

	test("returns null when the socket errors", async () => {
		const fakeSocket = new FakePortProbeSocket();
		queueMicrotask(() => {
			fakeSocket.emit("error", new Error("boom"));
		});

		await expect(
			checkPort("127.0.0.1", 443, 50, () => fakeSocket as any),
		).resolves.toBeNull();
		expect(fakeSocket.endCalls).toBe(0);
		expect(fakeSocket.destroyCalls).toBe(1);
	});

	test("destroys stalled sockets when the deadline expires", async () => {
		const fakeSocket = new FakePortProbeSocket();
		const startedAt = Date.now();

		await expect(
			checkPort("127.0.0.1", 443, 20, () => fakeSocket as any),
		).resolves.toBeNull();

		expect(fakeSocket.endCalls).toBe(0);
		expect(fakeSocket.destroyCalls).toBe(1);
		expect(Date.now() - startedAt).toBeLessThan(250);
	});
});