const API_BASE_URL = "https://api.mail.tm";
const STORAGE_KEY = "iscanTempMailMailbox";
const MAX_CREATE_ATTEMPTS = 5;
const MAX_MESSAGE_LOOKUP = 10;
const LOCAL_ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-";

function getRandomString(length, alphabet) {
	const values = new Uint32Array(length);
	globalThis.crypto.getRandomValues(values);
	let result = "";
	for (let index = 0; index < values.length; index += 1) {
		result += alphabet[values[index] % alphabet.length];
	}
	return result;
}

function createLocalPart() {
	return `iscan-${Date.now().toString(36)}-${getRandomString(6, LOCAL_ALPHABET)}`;
}

function createPassword() {
	return `${getRandomString(14, PASSWORD_ALPHABET)}${getRandomString(2, "23456789")}`;
}

async function readMailbox() {
	const result = await chrome.storage.local.get(STORAGE_KEY);
	return result[STORAGE_KEY] ?? null;
}

async function writeMailbox(mailbox) {
	await chrome.storage.local.set({ [STORAGE_KEY]: mailbox });
	return mailbox;
}

function publicMailbox(mailbox) {
	if (!mailbox) {
		return null;
	}

	return {
		address: mailbox.address,
		domain: mailbox.domain,
		createdAt: mailbox.createdAt,
		updatedAt: mailbox.updatedAt,
	};
}

async function parseJsonResponse(response) {
	const text = await response.text();
	let payload = null;

	try {
		payload = text ? JSON.parse(text) : null;
	} catch {
		payload = null;
	}

	if (!response.ok) {
		const message = payload?.["hydra:description"] || payload?.detail || payload?.message || response.statusText || `mail.tm request failed with ${response.status}`;
		throw Object.assign(new Error(message), {
			status: response.status,
			payload,
		});
	}

	return payload;
}

async function requestJson(path, init = {}, token) {
	const headers = new Headers(init.headers || {});
	headers.set("accept", "application/json");
	if (init.body && !headers.has("content-type")) {
		headers.set("content-type", "application/json");
	}
	if (token) {
		headers.set("authorization", `Bearer ${token}`);
	}

	const response = await fetch(`${API_BASE_URL}${path}`, {
		...init,
		headers,
	});

	return parseJsonResponse(response);
}

function collectionMembers(payload) {
	if (Array.isArray(payload)) {
		return payload;
	}
	if (Array.isArray(payload?.["hydra:member"])) {
		return payload["hydra:member"];
	}
	if (Array.isArray(payload?.members)) {
		return payload.members;
	}
	return [];
}

async function listPublicDomains() {
	const payload = await requestJson("/domains?page=1");
	const domains = collectionMembers(payload);
	return domains.filter((domain) => domain && domain.isActive && !domain.isPrivate && typeof domain.domain === "string");
}

async function loginMailbox(address, password) {
	const payload = await requestJson("/token", {
		method: "POST",
		body: JSON.stringify({ address, password }),
	});

	if (!payload?.token) {
		throw new Error("mail.tm returned no access token.");
	}

	return payload.token;
}

async function ensureMailbox(forceNew = false) {
	if (!forceNew) {
		const existing = await readMailbox();
		if (existing?.address && existing?.token) {
			return existing;
		}
		if (existing?.address && existing?.password) {
			existing.token = await loginMailbox(existing.address, existing.password);
			existing.updatedAt = new Date().toISOString();
			await writeMailbox(existing);
			return existing;
		}
	}

	const domains = await listPublicDomains();
	const domain = domains[0]?.domain;
	if (!domain) {
		throw new Error("mail.tm returned no active public domains.");
	}

	let lastError = null;

	for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
		const address = `${createLocalPart()}@${domain}`;
		const password = createPassword();

		try {
			const account = await requestJson("/accounts", {
				method: "POST",
				body: JSON.stringify({ address, password }),
			});
			const token = await loginMailbox(address, password);
			const now = new Date().toISOString();
			const mailbox = {
				address,
				password,
				token,
				domain,
				accountId: account?.id ?? null,
				createdAt: now,
				updatedAt: now,
			};

			await writeMailbox(mailbox);
			return mailbox;
		} catch (error) {
			lastError = error;
			if (error?.status !== 409 && error?.status !== 422) {
				break;
			}
		}
	}

	throw lastError || new Error("Failed to create a disposable mailbox.");
}

async function requestMailboxJson(path, init = {}) {
	const mailbox = await readMailbox();
	if (!mailbox?.address || !mailbox?.password) {
		throw new Error("No temp mailbox is available yet.");
	}

	if (!mailbox.token) {
		mailbox.token = await loginMailbox(mailbox.address, mailbox.password);
		mailbox.updatedAt = new Date().toISOString();
		await writeMailbox(mailbox);
	}

	try {
		const payload = await requestJson(path, init, mailbox.token);
		return { mailbox, payload };
	} catch (error) {
		if (error?.status === 401) {
			mailbox.token = await loginMailbox(mailbox.address, mailbox.password);
			mailbox.updatedAt = new Date().toISOString();
			await writeMailbox(mailbox);
			const payload = await requestJson(path, init, mailbox.token);
			return { mailbox, payload };
		}

		throw error;
	}
}

function flattenValue(value) {
	if (value == null) {
		return "";
	}
	if (typeof value === "string") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((entry) => flattenValue(entry)).filter(Boolean).join("\n");
	}
	if (typeof value === "object") {
		return Object.values(value).map((entry) => flattenValue(entry)).filter(Boolean).join("\n");
	}
	return String(value);
}

function stripMarkup(value) {
	return flattenValue(value)
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/\s+/g, " ")
		.trim();
}

function buildMessageCorpus(message) {
	return stripMarkup([
		message?.subject,
		message?.intro,
		message?.text,
		message?.html,
		message?.from?.address,
	].join("\n"));
}

function collectMatches(pattern, text) {
	pattern.lastIndex = 0;
	const results = [];
	let match = pattern.exec(text);
	while (match) {
		results.push(match[1] || match[0] || "");
		match = pattern.exec(text);
	}
	return results;
}

function normalizeCodeCandidate(value) {
	return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isValidCodeCandidate(value) {
	return value.length >= 4 && value.length <= 8 && !/^[A-Z]{4,}$/.test(value);
}

function uniqueValues(values) {
	return [...new Set(values)];
}

function extractVerificationCode(text) {
	const normalized = stripMarkup(text);
	if (!normalized) {
		return null;
	}

	const contextualMatches = collectMatches(/(?:verification|security|login|passcode|auth(?:entication)?|one[-\s]?time|otp|code)[^A-Z0-9]{0,20}([A-Z0-9-]{4,10})/ig, normalized);
	const sixDigitMatches = collectMatches(/\b\d{6}\b/g, normalized);
	const numericMatches = collectMatches(/\b\d{4,8}\b/g, normalized);
	const alphaNumericMatches = collectMatches(/\b[A-Z0-9]{6,8}\b/g, normalized);

	const candidates = uniqueValues([
		...contextualMatches,
		...sixDigitMatches,
		...numericMatches,
		...alphaNumericMatches,
		].map((entry) => normalizeCodeCandidate(entry)).filter((entry) => isValidCodeCandidate(entry)));

	return candidates[0] || null;
}

function summarizeText(value, maxLength = 120) {
	const clean = stripMarkup(value);
	if (clean.length <= maxLength) {
		return clean;
	}
	return `${clean.slice(0, maxLength - 3)}...`;
}

function normalizeMessageSummary(message) {
	if (!message) {
		return null;
	}

	return {
		id: message.id ?? null,
		subject: message.subject || "No subject",
		intro: message.intro || "",
		from: message.from?.address || message.from?.name || "",
		createdAt: message.createdAt || null,
		excerpt: summarizeText(message.intro || message.text || message.html || ""),
	};
}

async function listMessages(limit = MAX_MESSAGE_LOOKUP) {
	const { mailbox, payload } = await requestMailboxJson("/messages?page=1");
	const messages = collectionMembers(payload);
	return {
		mailbox,
		messages: messages.slice(0, limit),
	};
}

async function fetchMessage(id) {
	const { payload } = await requestMailboxJson(`/messages/${encodeURIComponent(id)}`);
	return payload;
}

async function getLatestCode() {
	const { mailbox, messages } = await listMessages();

	for (const summary of messages) {
		const summaryCode = extractVerificationCode(buildMessageCorpus(summary));
		if (summaryCode) {
			return {
				mailbox: publicMailbox(mailbox),
				code: summaryCode,
				message: normalizeMessageSummary(summary),
			};
		}

		if (summary?.id) {
			try {
				const detail = await fetchMessage(summary.id);
				const detailCode = extractVerificationCode(buildMessageCorpus(detail));
				if (detailCode) {
					return {
						mailbox: publicMailbox(mailbox),
						code: detailCode,
						message: normalizeMessageSummary(detail),
					};
				}
			} catch {
				// Ignore individual message fetch failures and continue.
			}
		}
	}

	return {
		mailbox: publicMailbox(mailbox),
		code: null,
		message: messages[0] ? normalizeMessageSummary(messages[0]) : null,
	};
}

async function handleMessage(message) {
	switch (message?.type) {
		case "iscan.mailTm.getMailbox": {
			return { mailbox: publicMailbox(await readMailbox()) };
		}
		case "iscan.mailTm.ensureMailbox": {
			const mailbox = await ensureMailbox(Boolean(message?.forceNew));
			return { mailbox: publicMailbox(mailbox) };
		}
		case "iscan.mailTm.getLatestCode": {
			return getLatestCode();
		}
		case "iscan.mailTm.listMessages": {
			const { mailbox, messages } = await listMessages(6);
			return {
				mailbox: publicMailbox(mailbox),
				messages: messages.map((entry) => normalizeMessageSummary(entry)).filter(Boolean),
			};
		}
		default:
			return null;
	}
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (!message || typeof message.type !== "string" || !message.type.startsWith("iscan.mailTm.")) {
		return false;
	}

	handleMessage(message)
		.then((result) => {
			sendResponse({ ok: true, ...result });
		})
		.catch((error) => {
			sendResponse({
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
		});

	return true;
});