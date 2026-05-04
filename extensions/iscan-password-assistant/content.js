(() => {
	const PANEL_WIDTH = 260;
	const PANEL_HEIGHT = 96;
	const PANEL_OFFSET = 8;
	const PASSWORD_LENGTH = 20;
	const LOWERCASE = "abcdefghijkmnopqrstuvwxyz";
	const UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ";
	const DIGITS = "23456789";
	const SYMBOLS = "!@#$%^&*()-_=+[]{}";
	const PASSWORD_ALPHABET = LOWERCASE + UPPERCASE + DIGITS + SYMBOLS;

	let activeInput = null;
	let overlayHost = null;
	let overlayPanel = null;
	let generateButton = null;

	function isPasswordInput(node) {
		return node instanceof HTMLInputElement && node.type === "password" && !node.disabled && !node.readOnly;
	}

	function findPasswordInput(target) {
		if (!target) {
			return null;
		}

		if (isPasswordInput(target)) {
			return target;
		}

		if (typeof target.composedPath === "function") {
			for (const entry of target.composedPath()) {
				if (isPasswordInput(entry)) {
					return entry;
				}
			}
		}

		return null;
	}

	function randomIndex(max) {
		const values = new Uint32Array(1);
		globalThis.crypto.getRandomValues(values);
		return values[0] % max;
	}

	function shuffle(items) {
		for (let index = items.length - 1; index > 0; index -= 1) {
			const swapIndex = randomIndex(index + 1);
			const current = items[index];
			items[index] = items[swapIndex];
			items[swapIndex] = current;
		}
	}

	function generatePassword() {
		const chars = [
			LOWERCASE[randomIndex(LOWERCASE.length)],
			UPPERCASE[randomIndex(UPPERCASE.length)],
			DIGITS[randomIndex(DIGITS.length)],
			SYMBOLS[randomIndex(SYMBOLS.length)],
		];

		for (let index = chars.length; index < PASSWORD_LENGTH; index += 1) {
			chars.push(PASSWORD_ALPHABET[randomIndex(PASSWORD_ALPHABET.length)]);
		}

		shuffle(chars);
		return chars.join("");
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

	function isVisible(input) {
		const rect = input.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	}

	function collectPasswordInputs(input) {
		const root = input.form || input.ownerDocument;
		const fields = Array.from(root.querySelectorAll('input[type="password"]'));
		return fields.filter((field) => isPasswordInput(field) && isVisible(field));
	}

	function fillPasswordIntoRelatedFields(input, password) {
		const fields = collectPasswordInputs(input);
		const candidates = fields.length > 1 ? fields : [input];

		for (const field of candidates) {
			if (field === input || field.value === "") {
				setNativeValue(field, password);
				dispatchInputEvents(field);
			}
		}

		focusInput(input, password.length);
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
		overlayHost.setAttribute("data-iscan-password-assistant", "1");

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
				border: 1px solid rgba(15, 23, 42, 0.14);
				background: #ffffff;
				box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
				font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
				color: #0f172a;
			}

			.label {
				font-size: 12px;
				font-weight: 600;
				letter-spacing: 0.02em;
				text-transform: uppercase;
				color: #475569;
				margin-bottom: 6px;
			}

			.hint {
				font-size: 13px;
				line-height: 1.4;
				margin-bottom: 10px;
			}

			.button {
				all: unset;
				box-sizing: border-box;
				width: 100%;
				padding: 10px 12px;
				border-radius: 10px;
				background: #0f172a;
				color: #ffffff;
				font-size: 14px;
				font-weight: 600;
				text-align: center;
				cursor: pointer;
			}

			.button:hover {
				background: #1e293b;
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

		const label = document.createElement("div");
		label.className = "label";
		label.textContent = "ISCAN Password";

		const hint = document.createElement("div");
		hint.className = "hint";
		hint.textContent = "Generate a strong password for this field.";

		generateButton = document.createElement("button");
		generateButton.className = "button";
		generateButton.type = "button";
		generateButton.textContent = "Generate strong password";
		generateButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (!activeInput) {
				return;
			}

			const password = generatePassword();
			fillPasswordIntoRelatedFields(activeInput, password);
			hideOverlay();
		});

		overlayPanel.append(label, hint, generateButton);
		shadow.append(style, overlayPanel);
		document.documentElement.appendChild(overlayHost);
	}

	function positionOverlay() {
		if (!overlayHost || !overlayPanel || !activeInput) {
			return;
		}

		const rect = activeInput.getBoundingClientRect();
		const horizontal = Math.min(
			window.innerWidth - PANEL_WIDTH - 12,
			Math.max(12, rect.right - PANEL_WIDTH),
		);
		const vertical = rect.bottom + PANEL_OFFSET + PANEL_HEIGHT > window.innerHeight
			? Math.max(12, rect.top - PANEL_HEIGHT - PANEL_OFFSET)
			: rect.bottom + PANEL_OFFSET;

		overlayHost.style.transform = `translate(${horizontal}px, ${vertical}px)`;
	}

	function showOverlay(input) {
		ensureOverlay();
		activeInput = input;
		overlayHost.style.display = "block";
		positionOverlay();
	}

	function hideOverlay() {
		activeInput = null;
		if (overlayHost) {
			overlayHost.style.display = "none";
		}
	}

	function isOverlayTarget(target) {
		return !!overlayHost && target instanceof Node && overlayHost.contains(target);
	}

	document.addEventListener("focusin", (event) => {
		const input = findPasswordInput(event);
		if (!input) {
			if (!isOverlayTarget(event.target)) {
				hideOverlay();
			}
			return;
		}

		showOverlay(input);
	}, true);

	document.addEventListener("pointerdown", (event) => {
		if (isOverlayTarget(event.target)) {
			return;
		}

		const input = findPasswordInput(event);
		if (!input) {
			hideOverlay();
			return;
		}

		showOverlay(input);
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