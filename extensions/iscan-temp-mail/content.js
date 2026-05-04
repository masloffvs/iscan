(() => {
	const PANEL_WIDTH = 308;
	const PANEL_OFFSET = 8;

	let activeInput = null;
	let activeMode = null;
	let overlayHost = null;
	let overlayPanel = null;
	let labelElement = null;
	let hintElement = null;
	let statusElement = null;
	let metaElement = null;
	let primaryButton = null;
	let secondaryButton = null;
	let requestToken = 0;

	function isEditableInput(node) {
		return node instanceof HTMLInputElement && !node.disabled && !node.readOnly;
	}

	function fieldMetadata(input) {
		return [
			input.type,
			input.name,
			input.id,
			input.autocomplete,
			input.placeholder,
			input.getAttribute("aria-label"),
			input.getAttribute("data-testid"),
		].filter(Boolean).join(" ").toLowerCase();
	}

	function isEmailInput(node) {
		if (!isEditableInput(node)) {
			return false;
		}

		const type = (node.type || "").toLowerCase();
		const metadata = fieldMetadata(node);
		return type === "email" || metadata.includes("email") || metadata.includes("e-mail");
	}

	function isOtpInput(node) {
		if (!isEditableInput(node)) {
			return false;
		}

		const type = (node.type || "text").toLowerCase();
		if (!["text", "search", "tel", "number"].includes(type)) {
			return false;
		}

		const metadata = fieldMetadata(node);
		const hasOtpAutocomplete = metadata.includes("one-time-code");
		const looksLikeCode = /(otp|verification|security|auth|passcode|pin|code)/.test(metadata);
		const maxLength = node.maxLength > 0 ? node.maxLength : 999;
		return hasOtpAutocomplete || (looksLikeCode && maxLength <= 8);
	}

	function findTrackedField(event) {
		if (!event || typeof event.composedPath !== "function") {
			return null;
		}

		for (const entry of event.composedPath()) {
			if (isEmailInput(entry)) {
				return { input: entry, mode: "email" };
			}
			if (isOtpInput(entry)) {
				return { input: entry, mode: "code" };
			}
		}

		return null;
	}

	function isVisible(input) {
		const rect = input.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	}

	function setNativeValue(input, value) {
		const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
		if (descriptor && typeof descriptor.set === "function") {
			descriptor.set.call(input, value);
			return;
		}

		input.value = value;
	}

	function dispatchInputEvents(input) {
		input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
		input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
	}

	function focusInput(input, valueLength) {
		if (!input || !input.isConnected) {
			return;
		}

		try {
			input.focus({ preventScroll: true });
		} catch {
			input.focus();
		}

		if (typeof valueLength === "number" && typeof input.setSelectionRange === "function") {
			input.setSelectionRange(valueLength, valueLength);
		}
	}

	function fieldRoot(input) {
		return input.form || input.ownerDocument;
	}

	function collectEmailInputs(input) {
		const root = fieldRoot(input);
		const candidates = Array.from(root.querySelectorAll("input"));
		return candidates.filter((field) => isEmailInput(field) && isVisible(field));
	}

	function fillEmailIntoRelatedFields(input, address) {
		const fields = collectEmailInputs(input);
		const targets = fields.length > 1 ? fields : [input];

		for (const field of targets) {
			if (field === input || field.value === "") {
				setNativeValue(field, address);
				dispatchInputEvents(field);
			}
		}

		focusInput(input, address.length);
	}

	function collectSingleCharOtpFields(container, activeField) {
		const fields = Array.from(container.querySelectorAll("input"));
		const candidates = fields.filter((field) => isOtpInput(field) && isVisible(field) && field.maxLength === 1);
		if (candidates.length >= 4 && candidates.length <= 8 && candidates.includes(activeField)) {
			return candidates;
		}
		return [];
	}

	function findOtpCluster(input) {
		let container = input.parentElement;
		while (container && container !== document.body) {
			const cluster = collectSingleCharOtpFields(container, input);
			if (cluster.length > 0) {
				return cluster;
			}
			container = container.parentElement;
		}
		return null;
	}

	function fillCodeIntoField(input, code) {
		const cluster = findOtpCluster(input);
		if (cluster && cluster.length > 0) {
			cluster.forEach((field, index) => {
				setNativeValue(field, code[index] || "");
				dispatchInputEvents(field);
			});
			const focusTarget = cluster[Math.min(cluster.length - 1, Math.max(code.length - 1, 0))];
			focusInput(focusTarget, Math.min(code.length, 1));
			return;
		}

		setNativeValue(input, code);
		dispatchInputEvents(input);
		focusInput(input, code.length);
	}

	function messageRequest(type, payload = {}) {
		return new Promise((resolve, reject) => {
			if (!chrome?.runtime?.sendMessage) {
				reject(new Error("ISCAN Temp Mail is unavailable."));
				return;
			}

			chrome.runtime.sendMessage({ type, ...payload }, (response) => {
				if (chrome.runtime.lastError) {
					reject(new Error(chrome.runtime.lastError.message));
					return;
				}

				if (!response?.ok) {
					reject(new Error(response?.error || "ISCAN Temp Mail request failed."));
					return;
				}

				resolve(response);
			});
		});
	}

	function ensureOverlay() {
		if (overlayHost) {
			return;
		}

		overlayHost = document.createElement("div");
		overlayHost.style.position = "fixed";
		overlayHost.style.left = "0";
		overlayHost.style.top = "0";
		overlayHost.style.display = "none";
		overlayHost.style.zIndex = "2147483647";
		overlayHost.setAttribute("data-iscan-temp-mail", "1");

		const shadow = overlayHost.attachShadow({ mode: "open" });
		const style = document.createElement("style");
		style.textContent = `
			:host {
				all: initial;
			}

			.panel {
				box-sizing: border-box;
				width: ${PANEL_WIDTH}px;
				padding: 12px;
				border-radius: 14px;
				border: 1px solid rgba(15, 23, 42, 0.12);
				background: #ffffff;
				box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
				font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
				color: #0f172a;
			}

			.label {
				font-size: 12px;
				font-weight: 700;
				letter-spacing: 0.04em;
				text-transform: uppercase;
				color: #475569;
				margin-bottom: 6px;
			}

			.hint {
				font-size: 13px;
				line-height: 1.45;
				margin-bottom: 10px;
			}

			.status {
				font-size: 14px;
				font-weight: 600;
				line-height: 1.4;
				word-break: break-word;
				margin-bottom: 6px;
			}

			.meta {
				font-size: 12px;
				line-height: 1.4;
				color: #475569;
				min-height: 18px;
				margin-bottom: 10px;
			}

			.actions {
				display: grid;
				gap: 8px;
			}

			.button {
				all: unset;
				box-sizing: border-box;
				padding: 10px 12px;
				border-radius: 10px;
				font-size: 14px;
				font-weight: 600;
				text-align: center;
				cursor: pointer;
			}

			.button[disabled] {
				opacity: 0.55;
				cursor: progress;
			}

			.button-primary {
				background: #0f172a;
				color: #ffffff;
			}

			.button-primary:hover:not([disabled]) {
				background: #1e293b;
			}

			.button-secondary {
				background: #e2e8f0;
				color: #0f172a;
			}

			.button-secondary:hover:not([disabled]) {
				background: #cbd5e1;
			}
		`;

		overlayPanel = document.createElement("div");
		overlayPanel.className = "panel";
		const keepInputFocus = (event) => {
			if (!activeInput) {
				return;
			}

			event.preventDefault();
			focusInput(activeInput, activeInput.value.length);
		};
		overlayPanel.addEventListener("pointerdown", keepInputFocus, true);
		overlayPanel.addEventListener("mousedown", keepInputFocus, true);

		labelElement = document.createElement("div");
		labelElement.className = "label";
		labelElement.textContent = "ISCAN Temp Mail";

		hintElement = document.createElement("div");
		hintElement.className = "hint";

		statusElement = document.createElement("div");
		statusElement.className = "status";

		metaElement = document.createElement("div");
		metaElement.className = "meta";

		const actions = document.createElement("div");
		actions.className = "actions";

		primaryButton = document.createElement("button");
		primaryButton.type = "button";
		primaryButton.className = "button button-primary";

		secondaryButton = document.createElement("button");
		secondaryButton.type = "button";
		secondaryButton.className = "button button-secondary";

		actions.append(primaryButton, secondaryButton);
		overlayPanel.append(labelElement, hintElement, statusElement, metaElement, actions);
		shadow.append(style, overlayPanel);
		document.documentElement.appendChild(overlayHost);
	}

	function isOverlayEvent(event) {
		return Boolean(overlayHost) && typeof event.composedPath === "function" && event.composedPath().includes(overlayHost);
	}

	function setButton(button, config) {
		if (!button) {
			return;
		}

		if (!config) {
			button.style.display = "none";
			button.onclick = null;
			button.disabled = false;
			return;
		}

		button.style.display = "block";
		button.textContent = config.label;
		button.disabled = Boolean(config.disabled);
		button.onclick = async (event) => {
			event.preventDefault();
			event.stopPropagation();
			try {
				await config.action();
			} catch (error) {
				statusElement.textContent = error instanceof Error ? error.message : String(error);
				metaElement.textContent = "mail.tm request failed.";
				positionOverlay();
			}
		};
	}

	function setBusy(isBusy) {
		if (primaryButton) {
			primaryButton.disabled = isBusy;
		}
		if (secondaryButton && secondaryButton.style.display !== "none") {
			secondaryButton.disabled = isBusy;
		}
	}

	function updateCopy({ hint, status, meta }) {
		hintElement.textContent = hint;
		statusElement.textContent = status;
		metaElement.textContent = meta || "";
		positionOverlay();
	}

	function positionOverlay() {
		if (!overlayHost || !overlayPanel || !activeInput) {
			return;
		}

		const rect = activeInput.getBoundingClientRect();
		const panelRect = overlayPanel.getBoundingClientRect();
		const width = panelRect.width || PANEL_WIDTH;
		const height = panelRect.height || 180;
		const horizontal = Math.min(
			window.innerWidth - width - 12,
			Math.max(12, rect.right - width),
		);
		const vertical = rect.bottom + PANEL_OFFSET + height > window.innerHeight
			? Math.max(12, rect.top - height - PANEL_OFFSET)
			: rect.bottom + PANEL_OFFSET;

		overlayHost.style.transform = `translate(${horizontal}px, ${vertical}px)`;
	}

	function hideOverlay() {
		activeInput = null;
		activeMode = null;
		requestToken += 1;
		if (overlayHost) {
			overlayHost.style.display = "none";
		}
	}

	async function showEmailOverlay() {
		const token = ++requestToken;
		updateCopy({
			hint: "Create a disposable mailbox for this field or reuse the current one.",
			status: "Checking temp mailbox...",
			meta: "",
		});
		setBusy(true);

		try {
			const response = await messageRequest("iscan.mailTm.getMailbox");
			if (token !== requestToken || activeMode !== "email") {
				return;
			}

			const mailbox = response.mailbox;
			if (mailbox?.address) {
				updateCopy({
					hint: "Fill this field with your disposable address or rotate to a fresh mailbox.",
					status: mailbox.address,
					meta: "mail.tm mailbox is ready.",
				});
				setButton(primaryButton, {
					label: "Fill current temp email",
					action: async () => {
						const fillResponse = await messageRequest("iscan.mailTm.ensureMailbox");
						if (activeInput) {
							fillEmailIntoRelatedFields(activeInput, fillResponse.mailbox.address);
							hideOverlay();
						}
					},
				});
				setButton(secondaryButton, {
					label: "New mailbox",
					action: async () => {
						const createResponse = await messageRequest("iscan.mailTm.ensureMailbox", { forceNew: true });
						if (activeInput) {
							fillEmailIntoRelatedFields(activeInput, createResponse.mailbox.address);
							hideOverlay();
						}
					},
				});
			} else {
				updateCopy({
					hint: "Create a disposable mailbox and fill this email field in one click.",
					status: "No temp mailbox yet.",
					meta: "",
				});
				setButton(primaryButton, {
					label: "Create and fill temp email",
					action: async () => {
						const createResponse = await messageRequest("iscan.mailTm.ensureMailbox");
						if (activeInput) {
							fillEmailIntoRelatedFields(activeInput, createResponse.mailbox.address);
							hideOverlay();
						}
					},
				});
				setButton(secondaryButton, null);
			}
		} catch (error) {
			if (token !== requestToken || activeMode !== "email") {
				return;
			}
			updateCopy({
				hint: "Temp mailbox lookup failed.",
				status: error instanceof Error ? error.message : String(error),
				meta: "",
			});
			setButton(primaryButton, {
				label: "Retry mailbox lookup",
				action: async () => {
					await showEmailOverlay();
				},
			});
			setButton(secondaryButton, null);
		} finally {
			if (token === requestToken) {
				setBusy(false);
				positionOverlay();
			}
		}
	}

	async function showCodeOverlay() {
		const token = ++requestToken;
		updateCopy({
			hint: "Fetch the latest verification code from your disposable inbox.",
			status: "Checking inbox...",
			meta: "",
		});
		setBusy(true);

		try {
			const response = await messageRequest("iscan.mailTm.getLatestCode");
			if (token !== requestToken || activeMode !== "code") {
				return;
			}

			if (response.code) {
				const fromText = response.message?.from ? `From ${response.message.from}` : response.mailbox?.address || "";
				const subjectText = response.message?.subject ? `Subject: ${response.message.subject}` : "";
				updateCopy({
					hint: "Paste the latest verification code into this field.",
					status: response.code,
					meta: [fromText, subjectText].filter(Boolean).join(" • "),
				});
				setButton(primaryButton, {
					label: "Paste latest code",
					action: async () => {
						if (activeInput) {
							fillCodeIntoField(activeInput, response.code);
							hideOverlay();
						}
					},
				});
				setButton(secondaryButton, {
					label: "Refresh inbox",
					action: async () => {
						await showCodeOverlay();
					},
				});
			} else if (response.mailbox?.address) {
				updateCopy({
					hint: "Mailbox exists, but no verification code was detected yet.",
					status: response.mailbox.address,
					meta: response.message?.subject ? `Latest message: ${response.message.subject}` : "Inbox is still empty.",
				});
				setButton(primaryButton, {
					label: "Refresh inbox",
					action: async () => {
						await showCodeOverlay();
					},
				});
				setButton(secondaryButton, null);
			} else {
				updateCopy({
					hint: "Create a disposable mailbox first, then come back here for the latest code.",
					status: "No temp mailbox yet.",
					meta: "",
				});
				setButton(primaryButton, {
					label: "Create mailbox",
					action: async () => {
						await messageRequest("iscan.mailTm.ensureMailbox");
						await showCodeOverlay();
					},
				});
				setButton(secondaryButton, null);
			}
		} catch (error) {
			if (token !== requestToken || activeMode !== "code") {
				return;
			}
			updateCopy({
				hint: "Inbox lookup failed.",
				status: error instanceof Error ? error.message : String(error),
				meta: "",
			});
			setButton(primaryButton, {
				label: "Retry inbox lookup",
				action: async () => {
					await showCodeOverlay();
				},
			});
			setButton(secondaryButton, null);
		} finally {
			if (token === requestToken) {
				setBusy(false);
				positionOverlay();
			}
		}
	}

	function showOverlay(input, mode) {
		ensureOverlay();
		activeInput = input;
		activeMode = mode;
		overlayHost.style.display = "block";
		setButton(primaryButton, null);
		setButton(secondaryButton, null);
		positionOverlay();
		if (mode === "email") {
			showEmailOverlay();
			return;
		}
		showCodeOverlay();
	}

	document.addEventListener("focusin", (event) => {
		if (isOverlayEvent(event)) {
			return;
		}

		const trackedField = findTrackedField(event);
		if (!trackedField) {
			hideOverlay();
			return;
		}

		showOverlay(trackedField.input, trackedField.mode);
	}, true);

	document.addEventListener("pointerdown", (event) => {
		if (isOverlayEvent(event)) {
			return;
		}

		const trackedField = findTrackedField(event);
		if (!trackedField) {
			hideOverlay();
			return;
		}

		showOverlay(trackedField.input, trackedField.mode);
	}, true);

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			hideOverlay();
		}
	}, true);

	window.addEventListener("resize", () => {
		positionOverlay();
	});

	window.addEventListener("scroll", () => {
		positionOverlay();
	}, true);
})();