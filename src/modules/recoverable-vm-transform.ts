import ts from "typescript";

function collectBindingNames(bindingName: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(bindingName)) {
    names.add(bindingName.text);
    return;
  }

  for (const element of bindingName.elements) {
    if (ts.isOmittedExpression(element)) {
      continue;
    }

    collectBindingNames(element.name, names);
  }
}

function collectTopLevelBindingNames(sourceFile: ts.SourceFile): string[] {
  const bindingNames = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, bindingNames);
      }
      continue;
    }

    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) {
      if (statement.name) {
        bindingNames.add(statement.name.text);
      }
    }
  }

  return [...bindingNames];
}

export function collectTopLevelBindingNamesFromSource(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    "recoverable-vm-bindings.tsx",
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  );

  return collectTopLevelBindingNames(sourceFile);
}

function hasTopLevelReturn(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(statement => ts.isReturnStatement(statement));
}

function collectPreludeStatements(sourceFile: ts.SourceFile): {
  bindingNames: string[];
  preludeStatements: string[];
} {
  const bindingNames = new Set<string>();
  const preludeStatements: string[] = [];
  const hoistedLetNames = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, bindingNames);
        collectBindingNames(declaration.name, hoistedLetNames);
      }
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      bindingNames.add(statement.name.text);
      preludeStatements.push(statement.getText(sourceFile));
      continue;
    }

    if (ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) {
      if (statement.name) {
        bindingNames.add(statement.name.text);
        hoistedLetNames.add(statement.name.text);
      }
    }
  }

  for (const bindingName of hoistedLetNames) {
    preludeStatements.unshift(`let ${bindingName};`);
  }

  return {
    bindingNames: [...bindingNames],
    preludeStatements,
  };
}

function transformVariableStatement(statement: ts.VariableStatement, sourceFile: ts.SourceFile): string[] {
  const transformedStatements: string[] = [];

  for (const declaration of statement.declarationList.declarations) {
    if (!declaration.initializer) {
      continue;
    }

    const bindingText = declaration.name.getText(sourceFile);
    const initializerText = declaration.initializer.getText(sourceFile);
    if (ts.isIdentifier(declaration.name)) {
      transformedStatements.push(`${bindingText} = ${initializerText};`);
      continue;
    }

    transformedStatements.push(`(${bindingText} = ${initializerText});`);
  }

  return transformedStatements;
}

function transformTopLevelStatement(statement: ts.Statement, sourceFile: ts.SourceFile): string[] {
  if (ts.isVariableStatement(statement)) {
    return transformVariableStatement(statement, sourceFile);
  }

  if (ts.isFunctionDeclaration(statement)) {
    return [];
  }

  if ((ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) {
    const name = statement.name.text;
    if (ts.isClassDeclaration(statement)) {
      return [`${name} = ${statement.getText(sourceFile)};`];
    }

    return [`${name} = (() => { ${statement.getText(sourceFile)} return ${name}; })();`];
  }

  return [statement.getText(sourceFile)];
}

function createPersistBindingStatement(bindingName: string): ts.Statement {
  return ts.factory.createTryStatement(
    ts.factory.createBlock([
      ts.factory.createExpressionStatement(
        ts.factory.createBinaryExpression(
          ts.factory.createElementAccessExpression(
            ts.factory.createIdentifier("globalThis"),
            ts.factory.createStringLiteral(bindingName),
          ),
          ts.SyntaxKind.EqualsToken,
          ts.factory.createIdentifier(bindingName),
        ),
      ),
    ], true),
    ts.factory.createCatchClause(
      undefined,
      ts.factory.createBlock([], true),
    ),
    undefined,
  );
}

function indentBlock(source: string, indent = "    "): string {
  if (source.length === 0) {
    return "";
  }

  return source
    .split("\n")
    .map(line => `${indent}${line}`)
    .join("\n");
}

export function buildPersistentAsyncCellSource(source: string): string {
  const sourceFile = ts.createSourceFile(
    "recoverable-vm-cell.tsx",
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  );
  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
  });

  const explicitReturn = hasTopLevelReturn(sourceFile);
  const { bindingNames, preludeStatements } = collectPreludeStatements(sourceFile);
  const bodyStatements = sourceFile.statements.flatMap((statement, index, statements) => {
    const isLastStatement = index === statements.length - 1;
    if (!explicitReturn && isLastStatement && ts.isExpressionStatement(statement)) {
      return [`return ${statement.expression.getText(sourceFile)};`];
    }

    return transformTopLevelStatement(statement, sourceFile);
  });

  const bodyText = bodyStatements.join("\n");
  const finallyText = bindingNames
    .map(bindingName => printer.printNode(
      ts.EmitHint.Unspecified,
      createPersistBindingStatement(bindingName),
      sourceFile,
    ))
    .join("\n");

  return [
    "(async () => {",
    indentBlock(preludeStatements.join("\n")),
    "  try {",
    indentBlock(bodyText),
    "  } finally {",
    indentBlock(finallyText),
    "  }",
    "})()",
  ].filter(Boolean).join("\n");
}