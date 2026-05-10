import { builtinLSPProviders as modernMonacoBuiltinLspProviders } from "modern-monaco/lsp";

export const builtinLSPProviders = {
	...modernMonacoBuiltinLspProviders,
	typescript: {
		aliases: ["javascript", "jsx", "tsx"],
		import: () => import("./typescript-setup.ts"),
	},
};