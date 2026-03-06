/* eslint-disable import/extensions -- .ts for Node/worker ESM resolution */
import * as path from 'path';
import type { SymbolDef, SymbolRef, SourceLocation } from '../spec/graph.spec.ts';
import { SymbolKind, ReferenceContext } from '../spec/graph.spec.ts';
import type { SyntaxNode } from './javascript.ts';
import { getPathForIds, resolveSpecifier } from '../pathUtils.ts';

function makeLocation(node: SyntaxNode, file: string): SourceLocation {
  return {
    file,
    line: node.startPosition.row + 1,
    column: node.startPosition.column,
    end_line: node.endPosition.row + 1,
    end_column: node.endPosition.column,
  };
}

function getModuleName(basename: string): string {
  return basename.replace(/\.(js|ts|jsx|tsx|mjs|cjs)$/i, '') || basename;
}

/** Infer class name from "return new ClassName()" in a statement block. */
function inferReturnTypeFromBody(body: SyntaxNode): string | null {
  for (const stmt of body.namedChildren || []) {
    if (stmt.type !== 'return_statement') continue;
    const expr = stmt.namedChildren.find((c) => c.type !== 'return');
    if (!expr) continue;
    if (expr.type === 'new_expression') {
      const cons = expr.childForFieldName('constructor');
      if (cons?.type === 'identifier') return cons.text;
    }
    if (expr.type === 'member_expression') {
      const obj = expr.childForFieldName('object');
      const prop = expr.childForFieldName('property');
      if (obj?.type === 'this' && prop && (prop.type === 'identifier' || prop.type === 'property_identifier')) {
        return `this.${prop.text}`;
      }
    }
  }
  return null;
}

/** From a class body, build map of this.propName -> ClassName from constructor assignments. */
function inferConstructorFieldTypes(classBody: SyntaxNode): Map<string, string> {
  const map = new Map<string, string>();
  for (const member of classBody.namedChildren || []) {
    if (member.type !== 'method_definition') continue;
    const nameNode = member.childForFieldName('name');
    if (!nameNode || nameNode.text !== 'constructor') continue;
    const body = member.childForFieldName('body');
    if (!body) break;
    for (const stmt of body.namedChildren || []) {
      const inner = stmt.type === 'expression_statement' ? stmt.namedChildren[0] : stmt;
      if (!inner || inner.type !== 'assignment_expression') continue;
      const left = inner.childForFieldName('left');
      const right = inner.childForFieldName('right');
      if (!left || left.type !== 'member_expression' || !right) continue;
      const obj = left.childForFieldName('object');
      const prop = left.childForFieldName('property');
      if (obj?.type !== 'this' || !prop) continue;
      const propName = prop.type === 'property_identifier' || prop.type === 'identifier' ? prop.text : null;
      if (!propName) continue;
      if (right.type === 'new_expression') {
        const cons = right.childForFieldName('constructor');
        if (cons?.type === 'identifier') map.set(propName, cons.text);
      }
    }
    break;
  }
  return map;
}

export class JavaScriptSymbolExtractor {
  private filename = '';
  private pathForIds = '';
  private moduleName = '';
  private moduleNodeId = '';
  private allFilePaths: string[] = [];
  private allDefs: SymbolDef[] = [];
  private defs: SymbolDef[] = [];
  private refs: SymbolRef[] = [];
  private importTable = new Map<string, string>();
  private scopeStack: string[] = [];
  private currentFunctionId: string | null = null;
  /** Stack of (var name -> class name) per scope for resolving obj.method() to ClassName.method. */
  private varTypeStack: Map<string, string>[] = [];

  extractDefs(
    rootNode: SyntaxNode,
    filename: string,
    allFilePaths: string[],
  ): SymbolDef[] {
    this.filename = filename;
    this.allFilePaths = allFilePaths;
    this.pathForIds = getPathForIds(filename, allFilePaths);
    this.moduleName = getModuleName(path.basename(filename));
    this.moduleNodeId = `file://${this.pathForIds}::${this.moduleName}`;
    this.defs = [];

    const program = rootNode.type === 'program' ? rootNode : rootNode;
    const statements = program.namedChildren || [];

    this.defs.push({
      id: this.moduleNodeId,
      name: this.moduleName,
      kind: SymbolKind.MODULE,
      scope: this.moduleName,
      location: makeLocation(program, this.pathForIds),
      ast_node_id: 'ast_module',
      metadata: new Map(),
    });

    for (const stmt of statements) {
      this.extractDefFromStatement(stmt);
    }

    return this.defs;
  }

  private extractDefFromStatement(node: SyntaxNode): void {
    switch (node.type) {
      case 'export_statement': {
        const decl = node.childForFieldName('declaration');
        if (decl) {
          this.extractDefFromDeclaration(decl, true);
        }
        const exportClause = node.namedChildren.find((c) => c.type === 'export_clause');
        if (exportClause) {
          for (const spec of exportClause.namedChildren) {
            if (spec.type === 'export_specifier') {
              const nameNode = spec.childForFieldName('name');
              if (nameNode) {
                const name = nameNode.text;
                const id = `file://${this.pathForIds}::${name}`;
                if (!this.defs.some((d) => d.id === id)) {
                  this.defs.push({
                    id,
                    name,
                    kind: SymbolKind.VARIABLE,
                    scope: this.moduleName,
                    location: makeLocation(spec, this.pathForIds),
                    ast_node_id: `ast_export_${name}`,
                    metadata: new Map([['exported', true]]),
                  });
                }
              }
            }
          }
        }
        break;
      }
      case 'function_declaration':
      case 'generator_function_declaration':
        this.extractFunctionDef(node);
        break;
      case 'class_declaration':
        this.extractClassDef(node);
        break;
      case 'lexical_declaration':
        this.extractLexicalDef(node);
        break;
      case 'variable_declaration':
        this.extractVariableDef(node);
        break;
      default:
        break;
    }
  }

  private extractDefFromDeclaration(node: SyntaxNode, _exported: boolean): void {
    switch (node.type) {
      case 'function_declaration':
      case 'generator_function_declaration':
        this.extractFunctionDef(node);
        break;
      case 'class_declaration':
        this.extractClassDef(node);
        break;
      case 'lexical_declaration':
        this.extractLexicalDef(node);
        break;
      case 'variable_declaration':
        this.extractVariableDef(node);
        break;
      default:
        break;
    }
  }

  private extractFunctionDef(node: SyntaxNode): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = nameNode.text;
    const qualName = [...this.scopeStack, name].join('.');
    const id = `file://${this.pathForIds}::${qualName}`;
    const body = node.childForFieldName('body');
    const returnType = body ? inferReturnTypeFromBody(body) : null;
    const metadata = new Map<string, unknown>();
    if (returnType) metadata.set('returnType', returnType);
    this.defs.push({
      id,
      name,
      kind: SymbolKind.FUNCTION,
      scope: [this.moduleName, ...this.scopeStack].join('.'),
      location: makeLocation(node, this.pathForIds),
      ast_node_id: `ast_func_${name}`,
      metadata,
    });
  }

  private extractClassDef(node: SyntaxNode): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = nameNode.text;
    const qualName = [...this.scopeStack, name].join('.');
    const id = `file://${this.pathForIds}::${qualName}`;
    this.defs.push({
      id,
      name,
      kind: SymbolKind.CLASS,
      scope: [this.moduleName, ...this.scopeStack].join('.'),
      location: makeLocation(node, this.pathForIds),
      ast_node_id: `ast_class_${name}`,
      metadata: new Map(),
    });
    this.scopeStack.push(name);
    const body = node.childForFieldName('body');
    const fieldTypes = body ? inferConstructorFieldTypes(body) : new Map<string, string>();
    if (body) {
      for (const member of body.namedChildren || []) {
        if (member.type === 'method_definition') {
          this.extractMethodDef(member, name, fieldTypes);
        }
      }
    }
    this.scopeStack.pop();
  }

  private extractMethodDef(
    node: SyntaxNode,
    className: string,
    fieldTypes: Map<string, string>,
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const methodName =
      nameNode.type === 'property_identifier' || nameNode.type === 'identifier'
        ? nameNode.text
        : nameNode.type === 'string'
          ? nameNode.text.slice(1, -1)
          : null;
    if (!methodName || methodName === 'constructor') return;
    const qualName = [...this.scopeStack, methodName].join('.');
    const id = `file://${this.pathForIds}::${qualName}`;
    const body = node.childForFieldName('body');
    let returnType: string | null = body ? inferReturnTypeFromBody(body) : null;
    if (returnType?.startsWith('this.') && fieldTypes.has(returnType.slice(6))) {
      returnType = fieldTypes.get(returnType.slice(6)) ?? null;
    } else if (returnType?.startsWith('this.')) {
      returnType = null;
    }
    const metadata = new Map<string, unknown>([['is_method', true]]);
    if (returnType) metadata.set('returnType', returnType);
    this.defs.push({
      id,
      name: methodName,
      kind: SymbolKind.FUNCTION,
      scope: [this.moduleName, ...this.scopeStack].join('.'),
      location: makeLocation(node, this.pathForIds),
      ast_node_id: `ast_method_${className}_${methodName}`,
      metadata,
    });
  }

  private extractLexicalDef(node: SyntaxNode): void {
    for (const decl of node.namedChildren) {
      if (decl.type !== 'variable_declarator') continue;
      const nameNode = decl.childForFieldName('name');
      if (!nameNode || nameNode.type !== 'identifier') continue;
      const name = nameNode.text;
      const qualName = [...this.scopeStack, name].join('.');
      const id = `file://${this.pathForIds}::${qualName}`;
      const kind =
        node.childForFieldName('kind')?.text === 'const'
          ? SymbolKind.CONSTANT
          : SymbolKind.VARIABLE;
      this.defs.push({
        id,
        name,
        kind,
        scope: [this.moduleName, ...this.scopeStack].join('.'),
        location: makeLocation(decl, this.pathForIds),
        ast_node_id: `ast_lexical_${name}`,
        metadata: new Map(),
      });
    }
  }

  private extractVariableDef(node: SyntaxNode): void {
    for (const decl of node.namedChildren) {
      if (decl.type !== 'variable_declarator') continue;
      const nameNode = decl.childForFieldName('name');
      if (!nameNode || nameNode.type !== 'identifier') continue;
      const name = nameNode.text;
      const qualName = [...this.scopeStack, name].join('.');
      const id = `file://${this.pathForIds}::${qualName}`;
      this.defs.push({
        id,
        name,
        kind: SymbolKind.VARIABLE,
        scope: [this.moduleName, ...this.scopeStack].join('.'),
        location: makeLocation(decl, this.pathForIds),
        ast_node_id: `ast_var_${name}`,
        metadata: new Map(),
      });
    }
  }

  extractRefs(
    rootNode: SyntaxNode,
    filename: string,
    globalDefs: SymbolDef[],
    allFilePaths: string[],
  ): SymbolRef[] {
    this.filename = filename;
    this.allFilePaths = allFilePaths;
    this.allDefs = globalDefs;
    this.pathForIds = getPathForIds(filename, allFilePaths);
    this.moduleName = getModuleName(path.basename(filename));
    this.moduleNodeId = `file://${this.pathForIds}::${this.moduleName}`;
    this.refs = [];
    this.importTable = new Map();
    this.scopeStack = [];
    this.currentFunctionId = null;
    this.varTypeStack = [new Map()];

    this.buildImportTable(rootNode);
    this.walkRefs(rootNode);
    return this.refs;
  }

  private buildImportTable(rootNode: SyntaxNode): void {
    const program = rootNode.type === 'program' ? rootNode : rootNode;
    for (const stmt of program.namedChildren || []) {
      if (stmt.type !== 'import_statement') continue;
      const sourceNode = stmt.childForFieldName('source');
      if (!sourceNode || sourceNode.type !== 'string') continue;
      const raw = sourceNode.text;
      const specifier = raw.slice(1, -1);
      const resolvedPath = resolveSpecifier(this.filename, specifier, this.allFilePaths);
      if (!resolvedPath) continue;
      const targetPathForIds = getPathForIds(resolvedPath, this.allFilePaths);
      const importClause = stmt.namedChildren.find((c) => c.type === 'import_clause');
      if (!importClause) continue;
      for (const child of importClause.namedChildren) {
        if (child.type === 'identifier') {
          const name = child.text;
          const targetId = `file://${targetPathForIds}::${name}`;
          if (this.allDefs.some((d) => d.id === targetId)) {
            this.importTable.set(name, targetId);
          }
        } else if (child.type === 'named_imports') {
          for (const spec of child.namedChildren) {
            if (spec.type !== 'import_specifier') continue;
            const nameNode = spec.childForFieldName('name');
            const aliasNode = spec.childForFieldName('alias');
            const importedName = nameNode?.type === 'identifier' ? nameNode.text : null;
            const localName =
              aliasNode?.type === 'identifier' ? aliasNode.text : importedName;
            if (importedName && localName) {
              const targetId = `file://${targetPathForIds}::${importedName}`;
              if (this.allDefs.some((d) => d.id === targetId)) {
                this.importTable.set(localName, targetId);
              }
            }
          }
        }
      }
    }
  }

  private resolveName(name: string): string | null {
    const fromImport = this.importTable.get(name);
    if (fromImport) return fromImport;
    const localId = `file://${this.pathForIds}::${name}`;
    if (this.allDefs.some((d) => d.id === localId)) return localId;
    const byName = this.allDefs.filter((d) => d.name === name);
    return byName.length > 0 ? byName[0].id : null;
  }

  /** Resolve ClassName.methodName to a method symbol id in allDefs. */
  private resolveMethod(className: string, methodName: string): string | null {
    const suffix = `::${className}.${methodName}`;
    const candidate = this.allDefs.find(
      (d) => d.name === methodName && d.id.endsWith(suffix),
    );
    return candidate?.id ?? null;
  }

  private getVarType(varName: string): string | null {
    for (let i = this.varTypeStack.length - 1; i >= 0; i--) {
      const t = this.varTypeStack[i].get(varName);
      if (t) return t;
    }
    return null;
  }

  private setVarType(varName: string, className: string): void {
    if (this.varTypeStack.length > 0) {
      this.varTypeStack[this.varTypeStack.length - 1].set(varName, className);
    }
  }

  /** Infer class name from expression for variable type tracking. */
  private inferTypeFromExpression(node: SyntaxNode): string | null {
    if (node.type === 'new_expression') {
      const cons = node.childForFieldName('constructor');
      return cons?.type === 'identifier' ? cons.text : null;
    }
    if (node.type === 'call_expression') {
      const func = node.childForFieldName('function');
      const calleeName = func?.type === 'identifier' ? func.text : this.getCalleeName(func!);
      if (!calleeName) return null;
      const defId = this.resolveName(calleeName);
      if (!defId) return null;
      const def = this.allDefs.find((d) => d.id === defId);
      const returnType = def?.metadata?.get('returnType');
      return typeof returnType === 'string' ? returnType : null;
    }
    return null;
  }

  private getCurrentScope(): string {
    return this.currentFunctionId ?? this.moduleNodeId;
  }

  private walkRefs(node: SyntaxNode): void {
    if (node.type === 'import_statement') {
      this.emitImportRefs(node);
      return;
    }
    if (node.type === 'program') {
      for (const c of node.namedChildren || []) {
        this.walkRefs(c);
      }
      return;
    }
    if (node.type === 'call_expression') {
      this.emitCallRef(node);
      return;
    }
    if (node.type === 'new_expression') {
      this.emitNewRef(node);
      return;
    }
    if (
      node.type === 'function_declaration' ||
      node.type === 'generator_function_declaration'
    ) {
      const nameNode = node.childForFieldName('name');
      const name = nameNode?.text;
      const prev = this.currentFunctionId;
      this.currentFunctionId = name
        ? `file://${this.pathForIds}::${[...this.scopeStack, name].join('.')}`
        : null;
      this.varTypeStack.push(new Map());
      const body = node.childForFieldName('body');
      if (body) {
        for (const c of body.namedChildren || []) {
          this.walkRefs(c);
        }
      }
      this.varTypeStack.pop();
      this.currentFunctionId = prev;
      return;
    }
    if (node.type === 'class_declaration') {
      const nameNode = node.childForFieldName('name');
      const name = nameNode?.text;
      if (name) this.scopeStack.push(name);
      const body = node.childForFieldName('body');
      if (body) {
        for (const c of body.namedChildren || []) {
          this.walkRefs(c);
        }
      }
      if (name) this.scopeStack.pop();
      return;
    }
    if (node.type === 'statement_block') {
      for (const c of node.namedChildren || []) {
        this.walkRefs(c);
      }
      return;
    }
    if (
      node.type === 'expression_statement' ||
      node.type === 'return_statement' ||
      node.type === 'if_statement' ||
      node.type === 'for_statement' ||
      node.type === 'for_in_statement' ||
      node.type === 'while_statement'
    ) {
      for (const c of node.namedChildren || []) {
        this.walkRefs(c);
      }
      return;
    }
    if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
      for (const decl of node.namedChildren || []) {
        if (decl.type !== 'variable_declarator') continue;
        const nameNode = decl.childForFieldName('name');
        const value = decl.childForFieldName('value');
        const varName = nameNode?.type === 'identifier' ? nameNode.text : null;
        if (varName && value) {
          const inferredType = this.inferTypeFromExpression(value);
          if (inferredType) this.setVarType(varName, inferredType);
        }
        if (value) this.walkRefs(value);
      }
      return;
    }
    if (node.type === 'assignment_expression') {
      for (const c of node.namedChildren || []) {
        this.walkRefs(c);
      }
      return;
    }
    if (node.type === 'member_expression') {
      for (const c of node.namedChildren || []) {
        this.walkRefs(c);
      }
      return;
    }
    for (const c of node.namedChildren || []) {
      this.walkRefs(c);
    }
  }

  private emitImportRefs(node: SyntaxNode): void {
    const importClause = node.namedChildren.find((c) => c.type === 'import_clause');
    if (!importClause) return;
    for (const child of importClause.namedChildren) {
      if (child.type === 'identifier') {
        const name = child.text;
        const targetId = this.importTable.get(name);
        if (targetId) {
          this.refs.push({
            path: targetId,
            location: makeLocation(node, this.pathForIds),
            context: ReferenceContext.IMPORT,
            scope: this.moduleNodeId,
            ast_node_id: `ast_import_${name}`,
          });
        }
      } else if (child.type === 'named_imports') {
        for (const spec of child.namedChildren) {
          if (spec.type !== 'import_specifier') continue;
          const nameNode = spec.childForFieldName('name');
          const aliasNode = spec.childForFieldName('alias');
          const importedName = nameNode?.type === 'identifier' ? nameNode.text : null;
          const localName =
            aliasNode?.type === 'identifier' ? aliasNode.text : importedName;
          if (localName) {
            const targetId = this.importTable.get(localName);
            if (targetId) {
              this.refs.push({
                path: targetId,
                location: makeLocation(spec, this.pathForIds),
                context: ReferenceContext.IMPORT,
                scope: this.moduleNodeId,
                ast_node_id: `ast_import_${localName}`,
              });
            }
          }
        }
      }
    }
  }

  private emitCallRef(node: SyntaxNode): void {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) return;
    if (funcNode.type === 'member_expression') {
      const obj = funcNode.childForFieldName('object');
      const prop = funcNode.childForFieldName('property');
      const objName =
        obj?.type === 'identifier' ? obj.text : null;
      const methodName =
        prop?.type === 'identifier' || prop?.type === 'property_identifier'
          ? prop.text
          : null;
      if (objName && methodName) {
        const className = this.getVarType(objName);
        if (className) {
          const targetId = this.resolveMethod(className, methodName);
          if (targetId) {
            const scope = this.getCurrentScope();
            if (scope !== targetId) {
              this.refs.push({
                path: targetId,
                location: makeLocation(node, this.pathForIds),
                context: ReferenceContext.FUNCTION_CALL,
                scope,
                ast_node_id: 'ast_call',
              });
            }
            return;
          }
        }
      }
    }
    const name = this.getCalleeName(funcNode);
    if (!name) return;
    const targetId = this.resolveName(name);
    if (!targetId) return;
    const scope = this.getCurrentScope();
    if (scope === targetId) return;
    this.refs.push({
      path: targetId,
      location: makeLocation(node, this.pathForIds),
      context: ReferenceContext.FUNCTION_CALL,
      scope,
      ast_node_id: 'ast_call',
    });
  }

  private getCalleeName(node: SyntaxNode): string | null {
    if (node.type === 'identifier') return node.text;
    if (node.type === 'member_expression') {
      const prop = node.childForFieldName('property');
      return prop?.type === 'identifier' || prop?.type === 'property_identifier'
        ? prop.text
        : null;
    }
    return null;
  }

  private emitNewRef(node: SyntaxNode): void {
    const cons = node.childForFieldName('constructor');
    if (!cons) return;
    const name = cons.type === 'identifier' ? cons.text : this.getCalleeName(cons);
    if (!name) return;
    const targetId = this.resolveName(name);
    if (!targetId) return;
    const scope = this.getCurrentScope();
    if (scope === targetId) return;
    this.refs.push({
      path: targetId,
      location: makeLocation(node, this.pathForIds),
      context: ReferenceContext.INSTANTIATION,
      scope,
      ast_node_id: 'ast_new',
    });
  }
}
