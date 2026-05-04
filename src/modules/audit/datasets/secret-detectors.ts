import type { AuditSecretDetector } from "../shared";

const CORE_SECRET_DETECTORS: AuditSecretDetector[] = [
	{
		kind: "jwt-like-token",
		severity: "high",
		message: "JWT-like token literal embedded in the client bundle.",
		regex: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}/gu,
	},
	{
		kind: "aws-access-key",
		severity: "high",
		message: "AWS access-key-like literal embedded in the client bundle.",
		regex: /AKIA[0-9A-Z]{16}/gu,
	},
	{
		kind: "google-api-key",
		severity: "high",
		message: "Google API-key-like literal embedded in the client bundle.",
		regex: /AIza[0-9A-Za-z\-_]{35}/gu,
	},
	{
		kind: "stripe-live-key",
		severity: "high",
		message: "Stripe live key literal embedded in the client bundle.",
		regex: /sk_live_[0-9A-Za-z]{16,}/gu,
	},
	{
		kind: "stripe-restricted-key",
		severity: "high",
		message: "Stripe restricted key literal embedded in the client bundle.",
		regex: /rk_live_[0-9A-Za-z]{16,}/gu,
	},
	{
		kind: "bearer-token",
		severity: "medium",
		message: "Bearer-style authorization token literal embedded in the client bundle.",
		regex: /\bBearer[ \t]+[A-Za-z0-9._~+\-/=:]{20,}\b/giu,
	},
];

const SCM_SECRET_DETECTORS: AuditSecretDetector[] = [
	{
		kind: "github-pat",
		severity: "high",
		message: "GitHub personal access token literal embedded in the client bundle.",
		regex: /\b(?:(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{20,255})\b/gu,
	},
	{
		kind: "gitlab-pat",
		severity: "high",
		message: "GitLab personal access token literal embedded in the client bundle.",
		regex: /\bglpat-[A-Za-z0-9_-]{20,255}\b/gu,
	},
	{
		kind: "npm-token",
		severity: "high",
		message: "npm access token literal embedded in the client bundle.",
		regex: /\bnpm_[A-Za-z0-9]{36,255}\b/gu,
	},
];

const CHAT_AND_COLLAB_SECRET_DETECTORS: AuditSecretDetector[] = [
	{
		kind: "telegram-bot-token",
		severity: "high",
		message: "Telegram bot token literal embedded in the client bundle.",
		regex: /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/gu,
	},
	{
		kind: "discord-token",
		severity: "high",
		message: "Discord token-like literal embedded in the client bundle.",
		regex: /\b(?:mfa\.[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,})\b/gu,
	},
	{
		kind: "discord-webhook-url",
		severity: "high",
		message: "Discord webhook URL embedded in the client bundle.",
		regex: /https:\/\/(?:canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[A-Za-z0-9._-]{32,}/gu,
	},
	{
		kind: "slack-token",
		severity: "high",
		message: "Slack token literal embedded in the client bundle.",
		regex: /\bxox(?:a|b|p|r|s)-[A-Za-z0-9-]{10,}\b/gu,
	},
	{
		kind: "slack-webhook-url",
		severity: "high",
		message: "Slack webhook URL embedded in the client bundle.",
		regex: /https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]{8,}\/[A-Z0-9]{8,}\/[A-Za-z0-9]{20,}/gu,
	},
];

const AI_SERVICE_SECRET_DETECTORS: AuditSecretDetector[] = [
	{
		kind: "openai-api-key",
		severity: "high",
		message: "OpenAI API key literal embedded in the client bundle.",
		regex: /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}\b/gu,
	},
	{
		kind: "anthropic-api-key",
		severity: "high",
		message: "Anthropic API key literal embedded in the client bundle.",
		regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/gu,
	},
	{
		kind: "groq-api-key",
		severity: "high",
		message: "Groq API key literal embedded in the client bundle.",
		regex: /\bgsk_[A-Za-z0-9]{20,255}\b/gu,
	},
	{
		kind: "huggingface-token",
		severity: "high",
		message: "Hugging Face access token literal embedded in the client bundle.",
		regex: /\bhf_[A-Za-z0-9]{30,255}\b/gu,
	},
	{
		kind: "replicate-api-token",
		severity: "high",
		message: "Replicate API token literal embedded in the client bundle.",
		regex: /\br8_[A-Za-z0-9]{20,255}\b/gu,
	},
	{
		kind: "openrouter-api-key",
		severity: "high",
		message: "OpenRouter API key literal embedded in the client bundle.",
		regex: /\bsk-or-v1-[A-Za-z0-9]{20,255}\b/gu,
	},
];

const BAAS_SECRET_DETECTORS: AuditSecretDetector[] = [
	{
		kind: "supabase-secret-key",
		severity: "high",
		message: "Supabase secret key literal embedded in the client bundle.",
		regex: /\bsb_secret_[A-Za-z0-9_-]{20,255}\b/gu,
	},
	{
		kind: "supabase-publishable-key",
		severity: "low",
		message: "Supabase publishable key literal appears in the client bundle. This can be intentional, but it is worth reviewing alongside RLS and service-role separation.",
		regex: /\bsb_publishable_[A-Za-z0-9_-]{20,255}\b/gu,
	},
];

export const AUDIT_SECRET_DETECTORS: AuditSecretDetector[] = [
	...CORE_SECRET_DETECTORS,
	...SCM_SECRET_DETECTORS,
	...CHAT_AND_COLLAB_SECRET_DETECTORS,
	...AI_SERVICE_SECRET_DETECTORS,
	...BAAS_SECRET_DETECTORS,
];