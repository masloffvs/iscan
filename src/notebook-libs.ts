import * as asyncModule from "async";
import * as turf from "@turf/turf";
import * as stdlibMathModule from "@stdlib/math";
import * as stdlibRandomModule from "@stdlib/random";
import * as stdlibStatsModule from "@stdlib/stats";
import * as stdlibStringModule from "@stdlib/string";
import * as stdlibUtilsModule from "@stdlib/utils";
import * as changeCase from "change-case";
import * as decimalModule from "decimal.js";
import dayjs from "dayjs";
import { JSONPath } from "jsonpath-plus";
import * as jsonataModule from "jsonata";
import * as lodash from "lodash-es";
import { all, create } from "mathjs";
import diff from "microdiff";
import * as ramda from "ramda";
import * as sugarModule from "sugar";
import * as uuid from "uuid";
import { type NotebookLibraryKey } from "./notebook-lib-definitions";

function interopDefault<T>(moduleValue: T): any {
  if (moduleValue && typeof moduleValue === "object" && "default" in moduleValue) {
    return (moduleValue as { default: unknown }).default;
  }

  return moduleValue;
}

const math = create(all);
const asyncLib = interopDefault(asyncModule);
const Decimal = interopDefault(decimalModule);
const jsonata = interopDefault(jsonataModule);
const sugar = interopDefault(sugarModule);
const stdlib = Object.freeze({
  math: interopDefault(stdlibMathModule),
  random: interopDefault(stdlibRandomModule),
  stats: interopDefault(stdlibStatsModule),
  string: interopDefault(stdlibStringModule),
  utils: interopDefault(stdlibUtilsModule),
});

export const notebookLibraryValues = {
  _: lodash,
  dayjs,
  uuid,
  changeCase,
  math,
  async: asyncLib,
  sugar,
  ramda,
  Decimal,
  turf,
  JSONPath,
  diff,
  jsonata,
  stdlib,
} as const satisfies Record<NotebookLibraryKey, unknown>;

export type NotebookLibraries = typeof notebookLibraryValues;

export { notebookLibraryDefinitions } from "./notebook-lib-definitions";

export function createNotebookLibrariesNamespace(): NotebookLibraries {
  return Object.freeze({ ...notebookLibraryValues });
}