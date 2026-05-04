const FILE_ICON_BY_NAME: Readonly<Record<string, string>> = {
	".dockerignore": "/icons/docker_ignore.png",
	".env": "/icons/settings.png",
	".env.example": "/icons/settings.png",
	".env.local": "/icons/settings.png",
	".eslintrc": "/icons/eslint.svg",
	".eslintrc.cjs": "/icons/eslint.svg",
	".eslintrc.js": "/icons/eslint.svg",
	".eslintrc.json": "/icons/eslint.svg",
	".eslintrc.yaml": "/icons/eslint.svg",
	".eslintrc.yml": "/icons/eslint.svg",
	".gitignore": "/icons/git_ignore.png",
	".prettierignore": "/icons/prettier_ignore.png",
	".prettierrc": "/icons/prettier.png",
	".prettierrc.cjs": "/icons/prettier.png",
	".prettierrc.js": "/icons/prettier.png",
	".prettierrc.json": "/icons/prettier.png",
	".prettierrc.yaml": "/icons/prettier.png",
	".prettierrc.yml": "/icons/prettier.png",
	"bun.lock": "/icons/bun-lock.svg",
	"bun.lockb": "/icons/bun-lock.svg",
	"bunfig.toml": "/icons/bun.svg",
	"cargo.lock": "/icons/cargo_lock.png",
	"cargo.toml": "/icons/cargo.png",
	"docker-compose.yaml": "/icons/docker_compose.png",
	"docker-compose.yml": "/icons/docker_compose.png",
	"dockerfile": "/icons/docker.svg",
	"eslint.config.js": "/icons/eslint.svg",
	"eslint.config.mjs": "/icons/eslint.svg",
	"eslint.config.ts": "/icons/eslint.svg",
	"jsconfig.json": "/icons/jsconfig.png",
	"makefile": "/icons/makefile.svg",
	"package-lock.json": "/icons/package-lock.svg",
	"package.json": "/icons/package-config.svg",
	"pnpm-lock.yaml": "/icons/pnpm_lock.png",
	"pnpm-lock.yml": "/icons/pnpm_lock.png",
	"tsconfig.json": "/icons/tsconfig.png",
	"vite.config.js": "/icons/vite.svg",
	"vite.config.ts": "/icons/vite.svg",
	"yarn.lock": "/icons/yarn-lock.svg",
};

const FILE_ICON_BY_EXTENSION: Readonly<Record<string, string>> = {
	aac: "/icons/audio.svg",
	ai: "/icons/image.svg",
	astro: "/icons/astro.svg",
	avi: "/icons/video.svg",
	bash: "/icons/shell.svg",
	bmp: "/icons/image.svg",
	c: "/icons/c.svg",
	cc: "/icons/cpp.svg",
	cpp: "/icons/cpp.svg",
	css: "/icons/css.svg",
	csv: "/icons/csv.svg",
	cts: "/icons/typescript.svg",
	db: "/icons/database.svg",
	diff: "/icons/diff.png",
	doc: "/icons/document.png",
	docx: "/icons/document.png",
	env: "/icons/settings.png",
	flac: "/icons/audio.svg",
	gif: "/icons/image.svg",
	go: "/icons/go.svg",
	graphql: "/icons/graphql.png",
	gql: "/icons/graphql.png",
	gz: "/icons/zip.svg",
	h: "/icons/c-header.svg",
	handlebars: "/icons/handlebars.png",
	hbs: "/icons/handlebars.png",
	hpp: "/icons/cpp-header.svg",
	html: "/icons/html.svg",
	htm: "/icons/html.svg",
	ini: "/icons/config.svg",
	ipynb: "/icons/jupyter.png",
	isb: "/icons/jupyter.png",
	jar: "/icons/jar.png",
	java: "/icons/java.svg",
	jpeg: "/icons/image.svg",
	jpg: "/icons/image.svg",
	js: "/icons/javascript.svg",
	json: "/icons/json.svg",
	json5: "/icons/json.svg",
	jsx: "/icons/react.svg",
	kt: "/icons/kotlin.svg",
	kts: "/icons/kotlin.svg",
	less: "/icons/less.png",
	lock: "/icons/lock.svg",
	log: "/icons/text.svg",
	lua: "/icons/lua.svg",
	md: "/icons/markdown.svg",
	mdx: "/icons/mdx.png",
	mjs: "/icons/javascript.svg",
	mov: "/icons/video.svg",
	mp3: "/icons/audio.svg",
	mp4: "/icons/video.svg",
	mts: "/icons/typescript.svg",
	nix: "/icons/nix.svg",
	ogg: "/icons/audio.svg",
	pdf: "/icons/pdf.svg",
	php: "/icons/php.svg",
	png: "/icons/image.svg",
	proto: "/icons/proto.png",
	py: "/icons/python.svg",
	pyc: "/icons/python_compiled.png",
	rb: "/icons/ruby.svg",
	rs: "/icons/rust.svg",
	sass: "/icons/sass.png",
	scala: "/icons/scala.svg",
	scss: "/icons/scss.svg",
	sh: "/icons/shell.svg",
	sql: "/icons/database.svg",
	sqlite: "/icons/database.svg",
	sqlite3: "/icons/database.svg",
	svg: "/icons/svg.svg",
	svelte: "/icons/svelte.svg",
	swift: "/icons/swift.svg",
	tar: "/icons/zip.svg",
	tgz: "/icons/zip.svg",
	toml: "/icons/toml.svg",
	ts: "/icons/typescript.svg",
	tsv: "/icons/table.png",
	tsx: "/icons/react-typescript.svg",
	txt: "/icons/text.svg",
	vue: "/icons/vue.svg",
	wasm: "/icons/web-assembly.svg",
	wav: "/icons/audio.svg",
	webm: "/icons/video.svg",
	webp: "/icons/image.svg",
	xls: "/icons/table.png",
	xlsx: "/icons/table.png",
	xml: "/icons/xml.svg",
	yaml: "/icons/yaml.svg",
	yml: "/icons/yaml.svg",
	zip: "/icons/zip.svg",
	zsh: "/icons/shell.svg",
};

function resolveSpecialFileIcon(normalizedName: string): string | null {
	if (normalizedName === "readme" || normalizedName.startsWith("readme.")) {
		return "/icons/readme.svg";
	}

	if (normalizedName === "license" || normalizedName.startsWith("license.")) {
		return "/icons/license.svg";
	}

	if (normalizedName === "changelog" || normalizedName.startsWith("changelog.")) {
		return "/icons/changelog.svg";
	}

	if (normalizedName.endsWith(".d.ts")) {
		return "/icons/typescript-def.svg";
	}

	if (normalizedName.endsWith(".test.ts") || normalizedName.endsWith(".spec.ts")) {
		return "/icons/test-yellow.svg";
	}

	if (normalizedName.endsWith(".test.tsx") || normalizedName.endsWith(".spec.tsx")) {
		return "/icons/test-yellow.svg";
	}

	if (normalizedName.endsWith(".test.js") || normalizedName.endsWith(".spec.js")) {
		return "/icons/test-yellow.svg";
	}

	if (normalizedName.endsWith(".test.jsx") || normalizedName.endsWith(".spec.jsx")) {
		return "/icons/test-yellow.svg";
	}

	return null;
}

export function getFileIcon(label: string): string {
	const normalizedName = label.trim().toLowerCase();
	if (normalizedName.length === 0) {
		return "/icons/_file.svg";
	}

	const exactMatch = FILE_ICON_BY_NAME[normalizedName];
	if (exactMatch) {
		return exactMatch;
	}

	const specialMatch = resolveSpecialFileIcon(normalizedName);
	if (specialMatch) {
		return specialMatch;
	}

	const extensionIndex = normalizedName.lastIndexOf(".");
	if (extensionIndex > -1 && extensionIndex < normalizedName.length - 1) {
		const extension = normalizedName.slice(extensionIndex + 1);
		const extensionMatch = FILE_ICON_BY_EXTENSION[extension];
		if (extensionMatch) {
			return extensionMatch;
		}
	}

	return "/icons/file.png";
}