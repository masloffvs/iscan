export type NotebookLibraryDefinition = {
  key: string;
  detail: string;
  editorTypeName: string;
  editorTypeSource: string;
};

const commonNotebookTypeDeclarations = [
  `type NotebookCellValue = any;`,
  `type NotebookAnyRecord = Record<string, any>;`,
  `type NotebookArrayLikeNumbers = readonly number[] | ArrayLike<number>;`,
  `type NotebookOutputTone = "command" | "output" | "info" | "error" | "muted" | "accent";`,
  `interface NotebookOutputEntityBase {
  id: string;
  createdAt: number;
  title?: string;
  meta?: NotebookAnyRecord;
}`,
  `type NotebookPrimitiveCellValue = string | number | boolean | null | undefined;`,
  `interface NotebookPrimitiveTextEntity extends NotebookOutputEntityBase {
  kind: "text";
  lines: string[];
  tone: NotebookOutputTone;
  presentation: {
    kind: "plain-text";
  };
}`,
  `interface NotebookPrimitiveTableColumn {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  width?: number;
  maxWidth?: number;
}`,
  `type NotebookPrimitiveTableRow = Record<string, NotebookPrimitiveCellValue>;`,
  `interface NotebookPrimitiveTableEntity extends NotebookOutputEntityBase {
  kind: "table";
  columns: NotebookPrimitiveTableColumn[];
  rows: NotebookPrimitiveTableRow[];
  presentation: {
    kind: "ink-table";
    dense?: boolean;
  };
}`,
  `type NotebookOutputEntity = NotebookPrimitiveTextEntity | NotebookPrimitiveTableEntity;`,
  `interface NotebookSessionHelpers {
  currentCellId: string | null;
  previousCellId: string | null;
  lastCellId: string | null;
  prev: NotebookCellValue;
  last: NotebookCellValue;
  get(cellId: string): NotebookCellValue;
  has(cellId: string): boolean;
  keys(): string[];
}`,
  `interface NotebookMathCompiledExpression {
  evaluate(scope?: NotebookAnyRecord): any;
}`,
  `interface NotebookMathNode {
  compile(): NotebookMathCompiledExpression;
  evaluate(scope?: NotebookAnyRecord): any;
  filter(callback: (node: NotebookMathNode, path: string, parent: NotebookMathNode | null) => boolean): NotebookMathNode[];
  toString(): string;
  transform(callback: (node: NotebookMathNode, path: string, parent: NotebookMathNode | null) => NotebookMathNode): NotebookMathNode;
  traverse(callback: (node: NotebookMathNode, path: string, parent: NotebookMathNode | null) => void): void;
}`,
  `interface NotebookMathMatrix {
  map(callback: (value: any, index: number[], matrix: NotebookMathMatrix) => any): NotebookMathMatrix;
  reshape(size: readonly number[]): NotebookMathMatrix;
  size(): number[];
  subset(index: any, replacement?: any): any;
  toArray(): any[];
  toString(): string;
  valueOf(): any;
}`,
  `interface NotebookMathUnit {
  clone(): NotebookMathUnit;
  format(options?: NotebookAnyRecord | number): string;
  splitUnits(parts?: readonly string[]): NotebookMathUnit[];
  to(unit: string | NotebookMathUnit): NotebookMathUnit;
  toNumber(unit?: string): number;
  toNumeric(unit?: string): number;
  toString(): string;
  value?: number;
}`,
  `interface NotebookMathChain {
  abs(): NotebookMathChain;
  add(value: any): NotebookMathChain;
  divide(value: any): NotebookMathChain;
  done(): any;
  format(options?: NotebookAnyRecord | number): string;
  multiply(value: any): NotebookMathChain;
  pow(value: any): NotebookMathChain;
  round(decimals?: number): NotebookMathChain;
  sqrt(): NotebookMathChain;
  subtract(value: any): NotebookMathChain;
  toArray(): any[];
  toString(): string;
  valueOf(): any;
}`,
  `type NotebookTurfPosition = [number, number] | [number, number, number];`,
  `type NotebookTurfBBox = [number, number, number, number] | [number, number, number, number, number, number];`,
  `type NotebookTurfUnits = "degrees" | "radians" | "miles" | "kilometers" | "meters" | "metres" | "centimeters" | "feet" | "yards" | "inches" | "nauticalmiles";`,
  `interface NotebookTurfGeometryBase {
  type: string;
  bbox?: NotebookTurfBBox;
}`,
  `interface NotebookTurfPointGeometry extends NotebookTurfGeometryBase {
  type: "Point";
  coordinates: NotebookTurfPosition;
}`,
  `interface NotebookTurfLineStringGeometry extends NotebookTurfGeometryBase {
  type: "LineString";
  coordinates: NotebookTurfPosition[];
}`,
  `interface NotebookTurfPolygonGeometry extends NotebookTurfGeometryBase {
  type: "Polygon";
  coordinates: NotebookTurfPosition[][];
}`,
  `type NotebookTurfGeometry = NotebookTurfPointGeometry | NotebookTurfLineStringGeometry | NotebookTurfPolygonGeometry;`,
  `interface NotebookTurfFeature<G extends NotebookTurfGeometry = NotebookTurfGeometry, P extends NotebookAnyRecord = NotebookAnyRecord> {
  type: "Feature";
  bbox?: NotebookTurfBBox;
  geometry: G;
  id?: string | number;
  properties: P;
}`,
  `interface NotebookTurfFeatureCollection<F extends NotebookTurfFeature = NotebookTurfFeature> {
  type: "FeatureCollection";
  bbox?: NotebookTurfBBox;
  features: F[];
}`,
  `type NotebookTurfGeoJson = NotebookTurfGeometry | NotebookTurfFeature | NotebookTurfFeatureCollection;`,
  `type NotebookTurfCoord = NotebookTurfPosition | NotebookTurfPointGeometry | NotebookTurfFeature<NotebookTurfPointGeometry>;`,
  `type NotebookTurfLineLike = NotebookTurfLineStringGeometry | NotebookTurfFeature<NotebookTurfLineStringGeometry>;`,
  `type NotebookTurfPolygonLike = NotebookTurfPolygonGeometry | NotebookTurfFeature<NotebookTurfPolygonGeometry>;`,
  `interface NotebookStdlibAccumulator {
  (value: number): number;
  value(): number;
}`,
  `interface NotebookStdlibMathNamespace {
  base: {
    special: {
      abs(x: number): number;
      ceil(x: number): number;
      cos(x: number): number;
      exp(x: number): number;
      floor(x: number): number;
      max(x: number, y: number): number;
      min(x: number, y: number): number;
      pow(x: number, y: number): number;
      round(x: number): number;
      sin(x: number): number;
      sqrt(x: number): number;
    };
    utils: {
      clamp(x: number, min: number, max: number): number;
      maxabs(values: NotebookArrayLikeNumbers): number;
    };
  };
}`,
  `interface NotebookStdlibRandomNamespace {
  base: {
    bernoulli(p?: number): 0 | 1;
    exponential(lambda?: number): number;
    normal(mu?: number, sigma?: number): number;
    randn(): number;
    uniform(a?: number, b?: number): number;
  };
}`,
  `interface NotebookStdlibStatsNamespace {
  base: {
    max(values: NotebookArrayLikeNumbers): number;
    mean(values: NotebookArrayLikeNumbers): number;
    median(values: NotebookArrayLikeNumbers): number;
    min(values: NotebookArrayLikeNumbers): number;
    quantile(values: NotebookArrayLikeNumbers, p: number): number;
    stdev(values: NotebookArrayLikeNumbers, correction?: number): number;
    variance(values: NotebookArrayLikeNumbers, correction?: number): number;
  };
  incr: {
    mean(): NotebookStdlibAccumulator;
    variance(): NotebookStdlibAccumulator;
  };
}`,
  `interface NotebookStdlibStringNamespace {
  base: {
    capitalize(value: string): string;
    kebabcase(value: string): string;
    lowercase(value: string): string;
    pad(value: string, length: number, fill?: string): string;
    trim(value: string): string;
    uppercase(value: string): string;
  };
  format(template: string, ...args: any[]): string;
}`,
  `interface NotebookStdlibUtilsNamespace {
  base: {
    identity<T>(value: T): T;
    noop(): void;
    once<T extends (...args: any[]) => any>(fn: T): T;
  };
  copy<T>(value: T): T;
  merge<T extends NotebookAnyRecord, U extends NotebookAnyRecord>(target: T, source: U): T & U;
  omit<T extends NotebookAnyRecord>(object: T, keys: readonly string[]): Partial<T>;
  pick<T extends NotebookAnyRecord>(object: T, keys: readonly string[]): Partial<T>;
}`,
] as const;

export const notebookLibraryDefinitions = [
  {
    key: "_",
    detail: "Lodash utility helpers",
    editorTypeName: "NotebookLodashLibrary",
    editorTypeSource: `Record<string, any> & {
  chunk<T>(array: readonly T[] | null | undefined, size?: number): T[][];
  get(object: any, path: string | readonly (string | number)[], defaultValue?: any): any;
  map<T, U>(collection: readonly T[] | Record<string, T> | null | undefined, iteratee: ((value: T, index: number) => U) | string): U[];
  set(object: any, path: string | readonly (string | number)[], value: any): any;
  uniq<T>(array: readonly T[] | null | undefined): T[];
}`,
  },
  {
    key: "dayjs",
    detail: "Day.js date and time helpers",
    editorTypeName: "NotebookDayjsLibrary",
    editorTypeSource: `((value?: any) => {
  add(amount: number, unit?: string): any;
  format(template?: string): string;
  subtract(amount: number, unit?: string): any;
  toDate(): Date;
  toISOString(): string;
  valueOf(): number;
}) & {
  extend(plugin: any, option?: any): any;
  isDayjs(value: unknown): boolean;
  unix(value?: number): any;
}`,
  },
  {
    key: "uuid",
    detail: "UUID generation helpers",
    editorTypeName: "NotebookUuidLibrary",
    editorTypeSource: `Record<string, any> & {
  parse(value: string): Uint8Array;
  stringify(value: ArrayLike<number>): string;
  validate(value: string): boolean;
  v4(options?: Record<string, any>): string;
}`,
  },
  {
    key: "changeCase",
    detail: "String case conversion helpers",
    editorTypeName: "NotebookChangeCaseLibrary",
    editorTypeSource: `Record<string, any> & {
  camelCase(value: string, options?: Record<string, any>): string;
  constantCase(value: string, options?: Record<string, any>): string;
  pascalCase(value: string, options?: Record<string, any>): string;
  snakeCase(value: string, options?: Record<string, any>): string;
}`,
  },
  {
    key: "math",
    detail: "Math.js expression and numeric helpers",
    editorTypeName: "NotebookMathLibrary",
    editorTypeSource: `NotebookAnyRecord & {
  abs(value: any): any;
  add(left: any, right: any): any;
  chain(value?: any): NotebookMathChain;
  compile(expression: string | NotebookMathNode): NotebookMathCompiledExpression;
  derivative(expression: string | NotebookMathNode, variable: string): NotebookMathNode;
  divide(left: any, right: any): any;
  format(value: any, options?: NotebookAnyRecord | number): string;
  index(...index: any[]): any;
  inv(value: any): any;
  matrix(value?: any): NotebookMathMatrix;
  mean(values: NotebookArrayLikeNumbers): number;
  evaluate(expression: string, scope?: Record<string, any>): any;
  multiply(left: any, right: any): any;
  parse(expression: string): NotebookMathNode;
  pow(left: any, right: any): any;
  round(value: number, decimals?: number): number;
  simplify(expression: string | NotebookMathNode, scope?: NotebookAnyRecord): NotebookMathNode;
  sqrt(value: number): number;
  subtract(left: any, right: any): any;
  sum(values: NotebookArrayLikeNumbers): number;
  transpose(value: any): any;
  unit(value: number | string, unit?: string): NotebookMathUnit;
  zeros(...size: number[]): NotebookMathMatrix;
}`,
  },
  {
    key: "async",
    detail: "Async control-flow and collection helpers",
    editorTypeName: "NotebookAsyncLibrary",
    editorTypeSource: `Record<string, any> & {
  each<T>(collection: readonly T[], iteratee: (value: T, index: number) => Promise<unknown> | unknown): Promise<void>;
  map<T, U>(collection: readonly T[], iteratee: (value: T, index: number) => Promise<U> | U): Promise<U[]>;
  parallel(tasks: ReadonlyArray<() => Promise<unknown> | unknown> | Record<string, () => Promise<unknown> | unknown>): Promise<any>;
  series(tasks: ReadonlyArray<() => Promise<unknown> | unknown> | Record<string, () => Promise<unknown> | unknown>): Promise<any>;
}`,
  },
  {
    key: "sugar",
    detail: "Sugar.js static helpers without mutating globals",
    editorTypeName: "NotebookSugarLibrary",
    editorTypeSource: `Record<string, any> & {
  Array: {
    map<T, U>(array: readonly T[], mapper: (value: T, index: number, array: readonly T[]) => U): U[];
    unique<T>(array: readonly T[]): T[];
  };
  Number: {
    round(value: number, precision?: number): number;
  };
  Object: {
    keys(object: Record<string, any>): string[];
  };
  String: {
    camelize(value: string): string;
    pad(value: string, length: number, padding?: string): string;
  };
}`,
  },
  {
    key: "ramda",
    detail: "Ramda functional helpers",
    editorTypeName: "NotebookRamdaLibrary",
    editorTypeSource: `Record<string, any> & {
  filter<T>(predicate: (value: T) => boolean, list: readonly T[]): T[];
  map<T, U>(mapper: (value: T) => U, list: readonly T[]): U[];
  path(path: readonly (string | number)[], value: any): any;
  pipe(...functions: Array<(...args: any[]) => any>): (...args: any[]) => any;
  prop(key: string, value: any): any;
}`,
  },
  {
    key: "Decimal",
    detail: "Decimal.js arbitrary-precision decimal arithmetic",
    editorTypeName: "NotebookDecimalConstructor",
    editorTypeSource: `{
  new(value: any): {
    div(value: any): any;
    minus(value: any): any;
    plus(value: any): any;
    times(value: any): any;
    toNumber(): number;
    toString(): string;
  };
  clone(config?: Record<string, any>): any;
  set(config?: Record<string, any>): any;
}`,
  },
  {
    key: "turf",
    detail: "Turf.js geospatial helpers",
    editorTypeName: "NotebookTurfLibrary",
    editorTypeSource: `NotebookAnyRecord & {
  area(feature: NotebookTurfGeoJson): number;
  bbox(feature: NotebookTurfGeoJson): NotebookTurfBBox;
  bboxPolygon(bbox: NotebookTurfBBox): NotebookTurfFeature<NotebookTurfPolygonGeometry>;
  booleanPointInPolygon(point: NotebookTurfCoord, polygon: NotebookTurfPolygonLike, options?: { ignoreBoundary?: boolean }): boolean;
  buffer<T extends NotebookTurfGeoJson>(feature: T, radius: number, options?: { units?: NotebookTurfUnits; steps?: number; properties?: NotebookAnyRecord }): T;
  centroid(feature: NotebookTurfGeoJson, options?: NotebookAnyRecord): NotebookTurfFeature<NotebookTurfPointGeometry>;
  circle(center: NotebookTurfCoord, radius: number, options?: { steps?: number; units?: NotebookTurfUnits; properties?: NotebookAnyRecord }): NotebookTurfFeature<NotebookTurfPolygonGeometry>;
  distance(from: NotebookTurfCoord, to: NotebookTurfCoord, options?: { units?: NotebookTurfUnits }): number;
  featureCollection<F extends NotebookTurfFeature>(features: readonly F[]): NotebookTurfFeatureCollection<F>;
  length(feature: NotebookTurfLineLike | NotebookTurfFeatureCollection, options?: { units?: NotebookTurfUnits }): number;
  lineString<P extends NotebookAnyRecord = NotebookAnyRecord>(coordinates: readonly NotebookTurfPosition[], properties?: P, options?: NotebookAnyRecord): NotebookTurfFeature<NotebookTurfLineStringGeometry, P>;
  point<P extends NotebookAnyRecord = NotebookAnyRecord>(coordinates: NotebookTurfPosition, properties?: P, options?: NotebookAnyRecord): NotebookTurfFeature<NotebookTurfPointGeometry, P>;
  polygon<P extends NotebookAnyRecord = NotebookAnyRecord>(coordinates: readonly NotebookTurfPosition[][], properties?: P, options?: NotebookAnyRecord): NotebookTurfFeature<NotebookTurfPolygonGeometry, P>;
  simplify<T extends NotebookTurfGeoJson>(feature: T, options?: { tolerance?: number; highQuality?: boolean; mutate?: boolean }): T;
  transformScale<T extends NotebookTurfGeoJson>(feature: T, factor: number, options?: NotebookAnyRecord): T;
}`,
  },
  {
    key: "JSONPath",
    detail: "JSONPath-plus query helper",
    editorTypeName: "NotebookJsonPathLibrary",
    editorTypeSource: `((options: {
  path: string;
  json: any;
  resultType?: string;
  wrap?: boolean;
}) => any[]) & {
  toPathArray(path: string): string[];
  toPathString(path: readonly (string | number)[]): string;
}`,
  },
  {
    key: "diff",
    detail: "Microdiff structural diff helper",
    editorTypeName: "NotebookDiffLibrary",
    editorTypeSource: `(left: any, right: any, options?: Record<string, any>) => Array<{
  oldValue?: any;
  path: Array<string | number>;
  type: "CHANGE" | "CREATE" | "REMOVE";
  value?: any;
}>`,
  },
  {
    key: "jsonata",
    detail: "JSONata query and transform helper (jq-like substitute)",
    editorTypeName: "NotebookJsonataLibrary",
    editorTypeSource: `((expression: string) => {
  assign(name: string, value: any): void;
  evaluate(input?: any, bindings?: Record<string, any>): Promise<any> | any;
  registerFunction(name: string, implementation: (...args: any[]) => any, signature?: string): void;
})`,
  },
  {
    key: "stdlib",
    detail: "Stdlib namespaces: math, random, stats, string, utils",
    editorTypeName: "NotebookStdlibLibrary",
    editorTypeSource: `{
  math: NotebookStdlibMathNamespace;
  random: NotebookStdlibRandomNamespace;
  stats: NotebookStdlibStatsNamespace;
  string: NotebookStdlibStringNamespace;
  utils: NotebookStdlibUtilsNamespace;
}`,
  },
] as const satisfies readonly NotebookLibraryDefinition[];

export type NotebookLibraryKey = typeof notebookLibraryDefinitions[number]["key"];

function sanitizeComment(value: string): string {
  return value.replaceAll("*/", "* /");
}

export function buildNotebookRuntimeTypeSource(): string {
  return [
    ...commonNotebookTypeDeclarations,
    "",
    ...notebookLibraryDefinitions.map((definition) => (
      `type ${definition.editorTypeName} = ${definition.editorTypeSource};`
    )),
    "",
    "interface NotebookRuntimeRoot {}",
    "declare const $: NotebookRuntimeRoot;",
    "declare const $vm: any;",
    "type NotebookSettingsValueSource = \"stored\" | \"default\" | \"invalid-stored-default\";",
    "type NotebookResolvedSettingValue<TValue = unknown> = { id: string; value: TValue; source: NotebookSettingsValueSource; updatedAt?: string; validationError?: string; };",
    "type NotebookSettingsHandle<TValue = unknown> = { result(): Promise<any>; unwrap(): Promise<TValue>; unwrapOrDefault(): Promise<TValue>; readResolved(): Promise<NotebookResolvedSettingValue<TValue>>; };",
    "type NotebookSettingsRoot = { get<TValue = unknown>(id: string): NotebookSettingsHandle<TValue>; listDefinitions(): Promise<any[]>; listCatalog(): Promise<any>; readResolved<TValue = unknown>(id: string): Promise<NotebookResolvedSettingValue<TValue>>; readStoredValue<TValue = unknown>(id: string): Promise<TValue | undefined>; resolveDefaultValue<TValue = unknown>(id: string): Promise<TValue>; set<TValue = unknown>(id: string, value: TValue): Promise<NotebookResolvedSettingValue<TValue>>; reset(id: string): Promise<boolean>; };",
    "declare const $settings: NotebookSettingsRoot;",
    "declare const $axios: any;",
    "declare const $axiosRegistry: any;",
    "declare const $prev: NotebookCellValue;",
    "declare const $last: NotebookCellValue;",
    "declare const $notebook: NotebookSessionHelpers;",
    "declare const $isb: NotebookSessionHelpers;",
    "declare const $libs: {",
    ...notebookLibraryDefinitions.flatMap((definition) => ([
      `  /** ${sanitizeComment(definition.detail)} */`,
      `  ${definition.key}: ${definition.editorTypeName};`,
    ])),
    "};",
  ].join("\n");
}