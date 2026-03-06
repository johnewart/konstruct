import * as path from 'path';
/* eslint-disable import/extensions -- .ts for Node/worker ESM resolution */
import type { SymbolDef, SymbolRef, SourceLocation } from '../spec/graph.spec.ts';
import { SymbolKind, ReferenceContext } from '../spec/graph.spec.ts';
import type { SyntaxNode } from './python.ts';
import { SymbolResolver } from '../graph/resolver.ts';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isConstantName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(name);
}

function makeLocation(node: SyntaxNode, file: string): SourceLocation {
  return {
    file,
    line: node.startPosition.row + 1,
    column: node.startPosition.column,
    end_line: node.endPosition.row + 1,
    end_column: node.endPosition.column,
  };
}

function getDocstring(bodyNode: SyntaxNode | null): string | null {
  if (!bodyNode) return null;
  const first = bodyNode.namedChildren[0];
  if (!first) return null;
  if (first.type === 'expression_statement') {
    const inner = first.namedChildren[0];
    if (inner && inner.type === 'string') {
      const raw = inner.text;
      // Strip surrounding triple or single quotes and whitespace
      return raw
        .replace(/^"""/, '').replace(/"""$/, '')
        .replace(/^'''/, '').replace(/'''$/, '')
        .replace(/^"/, '').replace(/"$/, '')
        .replace(/^'/, '').replace(/'$/, '')
        .trim();
    }
  }
  return null;
}

function extractParameters(paramsNode: SyntaxNode | null): {
  params: string[];
  paramTypes: Record<string, string>;
} {
  if (!paramsNode) return { params: [], paramTypes: {} };

  const params: string[] = [];
  const paramTypes: Record<string, string> = {};

  for (const child of paramsNode.namedChildren) {
    switch (child.type) {
      case 'identifier':
        params.push(child.text);
        break;
      case 'typed_parameter': {
        const nameNode = child.namedChildren[0];
        const typeNode = child.childForFieldName('type') ?? child.namedChildren[1];
        if (nameNode) {
          params.push(nameNode.text);
          if (typeNode) paramTypes[nameNode.text] = typeNode.text;
        }
        break;
      }
      case 'typed_default_parameter': {
        const nameNode = child.namedChildren[0];
        const typeNode = child.childForFieldName('type') ?? child.namedChildren[1];
        if (nameNode) {
          params.push(nameNode.text);
          if (typeNode && typeNode.type === 'type') {
            paramTypes[nameNode.text] = typeNode.text;
          }
        }
        break;
      }
      case 'default_parameter': {
        const nameNode = child.namedChildren[0];
        if (nameNode) params.push(nameNode.text);
        break;
      }
      case 'list_splat_pattern':
      case 'dictionary_splat_pattern': {
        const inner = child.namedChildren[0];
        if (inner) params.push((child.type === 'list_splat_pattern' ? '*' : '**') + inner.text);
        break;
      }
      default:
        break;
    }
  }

  return { params, paramTypes };
}

function isMainGuard(node: SyntaxNode): boolean {
  if (node.type !== 'if_statement') return false;
  const cond = node.namedChildren[0];
  if (!cond) return false;
  return cond.text.includes('__name__');
}

/**
 * Path segment for symbol ids: relative path from common root when multiple files,
 * else basename. Ensures same basename in different dirs (e.g. a/foo.py vs b/foo.py) stay distinct.
 */
function getPathForIds(filename: string, allFilePaths?: string[]): string {
  if (!allFilePaths || allFilePaths.length <= 1) {
    return path.basename(filename);
  }
  const root = computeCommonRoot(allFilePaths);
  const resolved = path.resolve(filename);
  const rel = path.relative(root, resolved);
  const normalized = rel.replace(/\\/g, '/') || path.basename(filename);
  return normalized;
}

function computeCommonRoot(filePaths: string[]): string {
  if (filePaths.length === 0) return '';
  const normalized = filePaths.map((p) => path.resolve(p).replace(/\\/g, '/'));
  let prefix = normalized[0];
  for (let i = 1; i < normalized.length; i++) {
    const p = normalized[i];
    while (prefix.length > 0 && !(p === prefix || p.startsWith(prefix + '/'))) {
      prefix = path.dirname(prefix).replace(/\\/g, '/');
    }
  }
  // prefix is the longest common path prefix; if it doesn't end with / it's the common directory
  return prefix || '/';
}

const BUILTINS = new Set([
  'print', 'len', 'range', 'str', 'int', 'float', 'bool', 'list', 'dict', 'set', 'tuple',
  'type', 'isinstance', 'issubclass', 'hasattr', 'getattr', 'setattr', 'delattr',
  'super', 'object', 'None', 'True', 'False', 'open', 'input', 'max', 'min', 'sum',
  'sorted', 'reversed', 'enumerate', 'zip', 'map', 'filter', 'any', 'all',
  'abs', 'round', 'repr', 'hash', 'id', 'dir', 'vars', 'callable', 'iter', 'next',
  'format', 'chr', 'ord', 'bin', 'hex', 'oct', 'bytes', 'bytearray', 'memoryview',
  'property', 'classmethod', 'staticmethod', 'Exception', 'ValueError', 'TypeError',
  'KeyError', 'IndexError', 'AttributeError', 'RuntimeError', 'NotImplementedError',
  'StopIteration', 'GeneratorExit', 'BaseException',
]);

const PRIMITIVES = new Set([
  'str', 'int', 'float', 'bool', 'list', 'dict', 'set', 'tuple', 'bytes',
  'None', 'Any', 'Optional', 'List', 'Dict', 'Set', 'Tuple', 'Union',
  'Callable', 'Type', 'ClassVar', 'Final',
]);

function isBuiltin(name: string): boolean { return BUILTINS.has(name); }
function isPrimitive(name: string): boolean { return PRIMITIVES.has(name); }

// ─── Main Extractor ───────────────────────────────────────────────────────────

export class PythonSymbolExtractor {
  // File context
  private filename: string = '';
  private basename: string = '';
  private moduleName: string = '';

  // Phase A counters & state
  private funcCounter = 0;
  private classCounter = 0;
  private assignCounter = 0;
  private scopeStack: string[] = []; // class names only
  private defs: SymbolDef[] = [];

  // Phase B state
  private refs: SymbolRef[] = [];
  private resolver!: SymbolResolver;
  private importTable: Map<string, string> = new Map();
  private moduleNodeId: string = '';

  // Per-class: className (simple, not qualified) → (attrName → resolved type path)
  private selfAttrMap: Map<string, Map<string, string>> = new Map();

  // Stack of current function paths and local type maps
  private classScopeStack: string[] = [];

  // Current function's local variable and parameter names (do not resolve to other files)
  private currentLocals: Set<string> = new Set();

  // Path segment for symbol ids (full relative path when multi-file, else basename)
  private pathForIds: string = '';
  // All file paths in this analysis (for import resolution and pathForIds)
  private allFilePaths: string[] = [];
  // Set of definition files from globalDefs (for resolving module name to file in buildImportTable)
  private allDefFiles: string[] = [];

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Extract symbol definitions from a parsed module.
   * Emits a MODULE node if the file has import statements.
   * @param allFilePaths When provided (multi-file), symbol ids use path relative to common root.
   */
  extractDefs(rootNode: SyntaxNode, filename: string, allFilePaths?: string[]): SymbolDef[] {
    this.filename = filename;
    this.basename = path.basename(filename);
    this.moduleName = this.basename.replace(/\.py$/, '');
    this.pathForIds = getPathForIds(filename, allFilePaths);
    this.defs = [];
    this.scopeStack = [];
    this.funcCounter = 0;
    this.classCounter = 0;
    this.assignCounter = 0;

    // Emit a MODULE node for every file so import edges to this module (e.g. from package import this_submodule) have a target
    const moduleId = `file://${this.pathForIds}::${this.moduleName}`;
    this.defs.push({
      id: moduleId,
      name: this.moduleName,
      kind: SymbolKind.MODULE,
      scope: this.moduleName,
      location: makeLocation(rootNode, this.filename),
      ast_node_id: `ast_module_${this.moduleName}`,
      metadata: new Map<string, any>(),
    });

    this.walkDefs(rootNode);
    return this.defs;
  }

  /**
   * Extract symbol references from a parsed module, given global defs for resolution.
   * @param allFilePaths When provided (multi-file), symbol ids use path relative to common root.
   */
  extractRefs(rootNode: SyntaxNode, filename: string, globalDefs: SymbolDef[], allFilePaths?: string[]): SymbolRef[] {
    this.filename = filename;
    this.basename = path.basename(filename);
    this.moduleName = this.basename.replace(/\.py$/, '');
    this.pathForIds = getPathForIds(filename, allFilePaths);
    this.allFilePaths = allFilePaths ?? [];
    this.allDefFiles = [...new Set(globalDefs.map((d) => d.location.file))];
    this.refs = [];
    this.resolver = new SymbolResolver(globalDefs);
    this.importTable = new Map();
    this.moduleNodeId = `file://${this.pathForIds}::${this.moduleName}`;
    this.classScopeStack = [];
    this.selfAttrMap = new Map();

    // Step 1: Build import table (name → resolved path)
    this.buildImportTable(rootNode);

    // Step 2: Collect self.attr type assignments from __init__ methods
    this.collectSelfAttrTypes(rootNode);

    // Step 3: Walk for references
    this.walkRefsModule(rootNode);

    return this.refs;
  }

  // ─── Phase A: Definitions ─────────────────────────────────────────────────

  private walkDefs(moduleNode: SyntaxNode): void {
    for (const child of moduleNode.namedChildren) {
      switch (child.type) {
        case 'class_definition':
          this.extractClassDef(child);
          break;
        case 'function_definition':
        case 'async_function_definition':
          this.extractFunctionDef(child);
          break;
        case 'assignment':
          // Direct assignment (rare at module level in some tree-sitter versions)
          this.extractAssignmentDef(child, false);
          break;
        case 'expression_statement': {
          // Module-level assignments are wrapped in expression_statement
          const inner = child.namedChildren[0];
          if (inner && inner.type === 'assignment') {
            this.extractAssignmentDef(inner, false);
          }
          break;
        }
        case 'decorated_definition': {
          const inner = child.namedChildren[child.namedChildren.length - 1];
          if (inner.type === 'class_definition') {
            this.extractClassDef(inner);
          } else if (inner.type === 'function_definition' || inner.type === 'async_function_definition') {
            this.extractFunctionDef(inner);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  private extractClassDef(node: SyntaxNode): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const className = nameNode.text;

    this.classCounter++;
    const astNodeId = `ast_classdef_${this.classCounter}`;
    const qualName = [...this.scopeStack, className].join('.');
    const id = `file://${this.pathForIds}::${qualName}`;
    const scope = [this.moduleName, ...this.scopeStack].join('.');

    // Superclasses
    const bases: string[] = [];
    const supersNode = node.childForFieldName('superclasses');
    if (supersNode) {
      for (const base of supersNode.namedChildren) {
        if (base.type === 'identifier' || base.type === 'attribute') {
          bases.push(base.text);
        }
      }
    }

    // Docstring
    const bodyNode = node.childForFieldName('body');
    const docstring = getDocstring(bodyNode);

    this.defs.push({
      id,
      name: className,
      kind: SymbolKind.CLASS,
      scope,
      location: makeLocation(node, this.filename),
      ast_node_id: astNodeId,
      metadata: new Map<string, any>([
        ['docstring', docstring],
        ['bases', bases],
      ]),
    });

    // Recurse into body with updated scope stack
    this.scopeStack.push(className);
    if (bodyNode) {
      for (const bodyChild of bodyNode.namedChildren) {
        if (bodyChild.type === 'function_definition' || bodyChild.type === 'async_function_definition') {
          this.extractFunctionDef(bodyChild);
        } else if (bodyChild.type === 'decorated_definition') {
          const inner = bodyChild.namedChildren[bodyChild.namedChildren.length - 1];
          if (inner.type === 'function_definition' || inner.type === 'async_function_definition') {
            this.extractFunctionDef(inner);
          }
        } else if (bodyChild.type === 'assignment') {
          this.extractAssignmentDef(bodyChild, true);
        } else if (bodyChild.type === 'expression_statement') {
          // Could be class-level assignment via expression_statement (rare)
          const inner = bodyChild.namedChildren[0];
          if (inner && inner.type === 'assignment') {
            this.extractAssignmentDef(inner, true);
          }
        }
      }
    }
    this.scopeStack.pop();
  }

  private extractFunctionDef(node: SyntaxNode): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const funcName = nameNode.text;

    this.funcCounter++;
    const astNodeId = `ast_funcdef_${this.funcCounter}`;
    const qualName = [...this.scopeStack, funcName].join('.');
    const id = `file://${this.pathForIds}::${qualName}`;
    const scope = [this.moduleName, ...this.scopeStack].join('.');

    const paramsNode = node.childForFieldName('parameters');
    const { params, paramTypes } = extractParameters(paramsNode);

    const returnTypeNode = node.childForFieldName('return_type');
    const returnType = returnTypeNode ? returnTypeNode.text : undefined;

    const bodyNode = node.childForFieldName('body');
    const docstring = getDocstring(bodyNode);

    const isMethod = this.scopeStack.length > 0;
    const isAsync = node.type === 'async_function_definition';
    const isPrivate = funcName.startsWith('_') && !/^__.*__$/.test(funcName);

    const metadata = new Map<string, any>([
      ['is_method', isMethod],
      ['is_async', isAsync],
      ['parameters', params],
      ['parameter_types', paramTypes],
    ]);
    if (returnType !== undefined) metadata.set('return_type', returnType);
    if (docstring !== null) metadata.set('docstring', docstring);
    if (isPrivate) metadata.set('is_private', true);

    this.defs.push({
      id,
      name: funcName,
      kind: SymbolKind.FUNCTION,
      scope,
      location: makeLocation(node, this.filename),
      ast_node_id: astNodeId,
      metadata,
    });
  }

  private extractAssignmentDef(node: SyntaxNode, isClassLevel: boolean): void {
    const left = node.namedChildren[0];
    if (!left || left.type !== 'identifier') return;

    const name = left.text;
    // Skip dunder names
    if (name.startsWith('__') && name.endsWith('__')) return;

    this.assignCounter++;
    const astNodeId = `ast_assign_${this.assignCounter}`;
    const qualName = [...this.scopeStack, name].join('.');
    const id = `file://${this.pathForIds}::${qualName}`;
    const scope = [this.moduleName, ...this.scopeStack].join('.');
    const kind = isConstantName(name) ? SymbolKind.CONSTANT : SymbolKind.VARIABLE;

    // Extract simple literal value
    const right = node.namedChildren[1];
    let value: any = undefined;
    if (right) {
      switch (right.type) {
        case 'integer': value = parseInt(right.text, 10); break;
        case 'float': value = parseFloat(right.text); break;
        case 'true': value = true; break;
        case 'false': value = false; break;
        case 'string':
          value = right.text
            .replace(/^"""/, '').replace(/"""$/, '')
            .replace(/^'''/, '').replace(/'''$/, '')
            .replace(/^"/, '').replace(/"$/, '')
            .replace(/^'/, '').replace(/'$/, '');
          break;
      }
    }

    const metadata = new Map<string, any>([['is_module_level', !isClassLevel]]);
    if (value !== undefined) metadata.set('value', value);

    this.defs.push({
      id,
      name,
      kind,
      scope,
      location: makeLocation(node, this.filename),
      ast_node_id: astNodeId,
      metadata,
    });
  }

  // ─── Phase B: References ─────────────────────────────────────────────────

  private buildImportTable(rootNode: SyntaxNode): void {
    for (const child of rootNode.namedChildren) {
      if (child.type === 'import_from_statement') {
        const moduleNode = child.namedChildren[0];
        if (!moduleNode) continue;
        const sourceModule = moduleNode.text;
        // Resolve module to actual file: single module (a/foo.py) or package (a/foo/__init__.py)
        const modulePathSuffix = sourceModule.replace(/\./g, path.sep) + '.py';
        const packageInitSuffix = sourceModule.replace(/\./g, path.sep) + path.sep + '__init__.py';
        const resolvedFile = this.allDefFiles.find((f) => {
          const norm = path.normalize(f);
          const normSlash = norm.replace(/\\/g, '/');
          const suffixPy = sourceModule.replace(/\./g, '/') + '.py';
          const suffixInit = sourceModule.replace(/\./g, '/') + '/__init__.py';
          return (
            norm.endsWith(path.normalize(modulePathSuffix)) ||
            norm.endsWith(path.normalize(packageInitSuffix)) ||
            normSlash.endsWith(suffixPy) ||
            normSlash.endsWith(suffixInit)
          );
        });
        const pathForIdsOfModule = resolvedFile
          ? getPathForIds(resolvedFile, this.allFilePaths.length > 0 ? this.allFilePaths : undefined)
          : sourceModule.replace(/\./g, '/') + '.py'; // fallback for unresolved
        const packageDir = resolvedFile ? path.dirname(resolvedFile) : '';

        for (let i = 1; i < child.namedChildren.length; i++) {
          const name = child.namedChildren[i].text;
          // Resolve each imported name as a submodule when source is a package (e.g. from endpoints import config_endpoints -> config_endpoints.py)
          let targetPath = `file://${pathForIdsOfModule}::${name}`;
          if (packageDir) {
            const submodulePy = path.join(packageDir, name + '.py');
            const submoduleInit = path.join(packageDir, name, '__init__.py');
            const submoduleFile = this.allDefFiles.find((f) => {
              const n = path.normalize(f);
              return n === path.normalize(submodulePy) || n === path.normalize(submoduleInit);
            });
            if (submoduleFile) {
              const pathForIdsOfSub = getPathForIds(
                submoduleFile,
                this.allFilePaths.length > 0 ? this.allFilePaths : undefined
              );
              const subModuleName = path.basename(submoduleFile).replace(/\.py$/, '');
              targetPath = `file://${pathForIdsOfSub}::${subModuleName}`;
            }
          }
          this.importTable.set(name, targetPath);
        }
      }
    }
  }

  /**
   * Pre-pass: collect self.attr type assignments from all __init__ methods.
   * This is needed before processing other methods so that self.attr.method() calls
   * can be resolved.
   */
  private collectSelfAttrTypes(rootNode: SyntaxNode): void {
    for (const child of rootNode.namedChildren) {
      let classDef: SyntaxNode | null = null;
      if (child.type === 'class_definition') {
        classDef = child;
      } else if (child.type === 'decorated_definition') {
        const inner = child.namedChildren[child.namedChildren.length - 1];
        if (inner.type === 'class_definition') classDef = inner;
      }
      if (!classDef) continue;

      const nameNode = classDef.childForFieldName('name');
      if (!nameNode) continue;
      const className = nameNode.text;

      const bodyNode = classDef.childForFieldName('body');
      if (!bodyNode) continue;

      // Find __init__ in class body
      for (const bodyChild of bodyNode.namedChildren) {
        let funcNode: SyntaxNode | null = null;
        if (bodyChild.type === 'function_definition') {
          funcNode = bodyChild;
        } else if (bodyChild.type === 'decorated_definition') {
          const inner = bodyChild.namedChildren[bodyChild.namedChildren.length - 1];
          if (inner.type === 'function_definition') funcNode = inner;
        }
        if (!funcNode) continue;

        const funcNameNode = funcNode.childForFieldName('name');
        if (funcNameNode?.text !== '__init__') continue;

        // Collect self.attr = TypeConstructor() assignments
        const initBody = funcNode.childForFieldName('body');
        if (!initBody) continue;
        if (!this.selfAttrMap.has(className)) {
          this.selfAttrMap.set(className, new Map());
        }
        const attrMap = this.selfAttrMap.get(className)!;
        this.extractSelfAttrAssignmentsFromBody(initBody, attrMap);
        break; // Only __init__ matters
      }
    }
  }

  private extractSelfAttrAssignmentsFromBody(
    bodyNode: SyntaxNode,
    attrMap: Map<string, string>
  ): void {
    for (const stmt of bodyNode.namedChildren) {
      const assignNode =
        stmt.type === 'expression_statement' ? stmt.namedChildren[0] : stmt;
      if (!assignNode || assignNode.type !== 'assignment') continue;

      const left = assignNode.namedChildren[0];
      const right = assignNode.namedChildren[1];
      if (!left || !right) continue;

      // self.attr = SomeType(...)
      if (
        left.type === 'attribute' &&
        left.namedChildren[0]?.text === 'self'
      ) {
        const attrName = left.namedChildren[1]?.text;
        if (!attrName) continue;
        const typePath = this.inferExprType(right, new Map());
        if (typePath) attrMap.set(attrName, typePath);
      }
    }
  }

  private walkRefsModule(rootNode: SyntaxNode): void {
    for (const child of rootNode.namedChildren) {
      switch (child.type) {
        case 'import_from_statement':
          this.processImportStatement(child);
          break;
        case 'class_definition':
          this.walkRefsClass(child);
          break;
        case 'function_definition':
        case 'async_function_definition':
          this.walkRefsFunction(child);
          break;
        case 'decorated_definition': {
          const inner = child.namedChildren[child.namedChildren.length - 1];
          if (inner.type === 'class_definition') {
            this.walkRefsClass(inner);
          } else if (
            inner.type === 'function_definition' ||
            inner.type === 'async_function_definition'
          ) {
            this.walkRefsFunction(inner);
          }
          break;
        }
        case 'if_statement':
          // Skip __main__ guard
          break;
        default:
          break;
      }
    }
  }

  private processImportStatement(node: SyntaxNode): void {
    for (let i = 1; i < node.namedChildren.length; i++) {
      const name = node.namedChildren[i].text;
      const targetPath = this.importTable.get(name);
      if (!targetPath) continue;
      this.refs.push({
        path: targetPath,
        location: makeLocation(node, this.filename),
        context: ReferenceContext.IMPORT,
        scope: this.moduleNodeId,
        ast_node_id: `ast_import_${name}`,
      });
    }
  }

  private walkRefsClass(classNode: SyntaxNode): void {
    const nameNode = classNode.childForFieldName('name');
    if (!nameNode) return;
    const className = nameNode.text;

    this.classScopeStack.push(className);

    const bodyNode = classNode.childForFieldName('body');
    if (bodyNode) {
      for (const bodyChild of bodyNode.namedChildren) {
        if (
          bodyChild.type === 'function_definition' ||
          bodyChild.type === 'async_function_definition'
        ) {
          this.walkRefsFunction(bodyChild);
        } else if (bodyChild.type === 'decorated_definition') {
          const inner = bodyChild.namedChildren[bodyChild.namedChildren.length - 1];
          if (
            inner.type === 'function_definition' ||
            inner.type === 'async_function_definition'
          ) {
            this.walkRefsFunction(inner);
          }
        }
      }
    }

    this.classScopeStack.pop();
  }

  private walkRefsFunction(funcNode: SyntaxNode): void {
    const nameNode = funcNode.childForFieldName('name');
    if (!nameNode) return;
    const funcName = nameNode.text;

    const qualName = [...this.classScopeStack, funcName].join('.');
    const funcPath = `file://${this.pathForIds}::${qualName}`;
    const localTypeMap = new Map<string, string>();

    // Track parameters and locals so we don't resolve them to symbols in other files
    const paramsNode = funcNode.childForFieldName('parameters');
    const { params } = extractParameters(paramsNode);
    this.currentLocals = new Set(params);

    // Process parameter type annotations → USES_TYPE
    if (paramsNode) {
      this.processParamAnnotations(paramsNode, funcPath);
    }

    // Process return type annotation → USES_TYPE
    const returnTypeNode = funcNode.childForFieldName('return_type');
    if (returnTypeNode) {
      const typeName = returnTypeNode.text;
      if (typeName && !isPrimitive(typeName)) {
        const typePath = this.resolveTypeName(typeName);
        if (typePath) {
          this.refs.push({
            path: typePath,
            location: makeLocation(returnTypeNode, this.basename),
            context: ReferenceContext.TYPE_ANNOTATION,
            scope: funcPath,
            ast_node_id: `ast_return_type_${funcName}`,
          });
        }
      }
    }

    // Walk function body
    const bodyNode = funcNode.childForFieldName('body');
    if (bodyNode) {
      this.walkFuncBody(bodyNode, funcPath, localTypeMap);
    }
  }

  private processParamAnnotations(paramsNode: SyntaxNode, funcPath: string): void {
    for (const child of paramsNode.namedChildren) {
      if (
        child.type === 'typed_parameter' ||
        child.type === 'typed_default_parameter'
      ) {
        const typeNode = child.childForFieldName('type');
        if (typeNode) {
          const typeName = typeNode.text;
          if (typeName && !isPrimitive(typeName)) {
            const typePath = this.resolveTypeName(typeName);
            if (typePath) {
              this.refs.push({
                path: typePath,
                location: makeLocation(typeNode, this.basename),
                context: ReferenceContext.TYPE_ANNOTATION,
                scope: funcPath,
                ast_node_id: `ast_param_type_${typeName}`,
              });
            }
          }
        }
      }
    }
  }

  private walkFuncBody(
    bodyNode: SyntaxNode,
    funcPath: string,
    localTypeMap: Map<string, string>
  ): void {
    for (const stmt of bodyNode.namedChildren) {
      this.processStatement(stmt, funcPath, localTypeMap);
    }
  }

  private processStatement(
    stmt: SyntaxNode,
    funcPath: string,
    localTypeMap: Map<string, string>
  ): void {
    switch (stmt.type) {
      case 'expression_statement': {
        const inner = stmt.namedChildren[0];
        if (!inner) break;
        if (inner.type === 'assignment') {
          this.processAssignment(inner, funcPath, localTypeMap);
        } else {
          this.processExprForRefs(inner, funcPath, localTypeMap);
        }
        break;
      }
      case 'return_statement': {
        const val = stmt.namedChildren[0];
        if (val) this.processExprForRefs(val, funcPath, localTypeMap);
        break;
      }
      case 'if_statement': {
        for (const child of stmt.namedChildren) {
          if (child.type === 'block') {
            this.walkFuncBody(child, funcPath, localTypeMap);
          } else {
            this.processExprForRefs(child, funcPath, localTypeMap);
          }
        }
        break;
      }
      case 'for_statement':
      case 'while_statement':
      case 'with_statement': {
        const lastChild = stmt.namedChildren[stmt.namedChildren.length - 1];
        if (lastChild?.type === 'block') {
          this.walkFuncBody(lastChild, funcPath, localTypeMap);
        }
        break;
      }
      default:
        break;
    }
  }

  private processAssignment(
    assignNode: SyntaxNode,
    funcPath: string,
    localTypeMap: Map<string, string>
  ): void {
    const left = assignNode.namedChildren[0];
    const right = assignNode.namedChildren[1];
    if (!left || !right) return;

    // Process RHS: emits edges AND returns resolved type for LHS
    const rhsTypePath = this.processRHSAndInferType(right, funcPath, localTypeMap);

    // Track local variable type and name (so we don't resolve to other files)
    if (left.type === 'identifier') {
      this.currentLocals.add(left.text);
      if (rhsTypePath) localTypeMap.set(left.text, rhsTypePath);
    }
  }

  /**
   * Process a RHS expression: emit refs (calls, reads) and return the inferred type path.
   */
  private processRHSAndInferType(
    node: SyntaxNode,
    funcPath: string,
    localTypeMap: Map<string, string>
  ): string | null {
    if (node.type === 'call') {
      return this.processCallExpr(node, funcPath, localTypeMap);
    } else if (node.type === 'identifier') {
      this.maybeEmitReadRef(node, funcPath);
      return null;
    } else if (node.type === 'string') {
      this.processStringNode(node, funcPath, localTypeMap);
      return null;
    } else {
      // Recurse for anything else
      for (const child of node.namedChildren) {
        this.processRHSAndInferType(child, funcPath, localTypeMap);
      }
      return null;
    }
  }

  /**
   * Process any expression for side-effects (refs) without needing type return.
   */
  private processExprForRefs(
    node: SyntaxNode,
    funcPath: string,
    localTypeMap: Map<string, string>
  ): void {
    if (node.type === 'call') {
      this.processCallExpr(node, funcPath, localTypeMap);
    } else if (node.type === 'identifier') {
      this.maybeEmitReadRef(node, funcPath);
    } else if (node.type === 'string') {
      this.processStringNode(node, funcPath, localTypeMap);
    } else {
      for (const child of node.namedChildren) {
        this.processExprForRefs(child, funcPath, localTypeMap);
      }
    }
  }

  private processStringNode(
    strNode: SyntaxNode,
    funcPath: string,
    localTypeMap: Map<string, string>
  ): void {
    for (const child of strNode.namedChildren) {
      if (child.type === 'interpolation') {
        for (const inner of child.namedChildren) {
          if (inner.type === 'call') {
            this.processCallExpr(inner, funcPath, localTypeMap);
          } else if (inner.type === 'identifier') {
            this.maybeEmitReadRef(inner, funcPath);
          } else {
            this.processExprForRefs(inner, funcPath, localTypeMap);
          }
        }
      }
    }
  }

  private maybeEmitReadRef(node: SyntaxNode, funcPath: string): void {
    const name = node.text;
    if (isBuiltin(name) || isPrimitive(name)) return;
    if (name === 'self' || name === 'cls') return;

    const def = this.resolveSymbol(name);
    if (def && (def.kind === SymbolKind.CONSTANT || def.kind === SymbolKind.VARIABLE)) {
      this.refs.push({
        path: def.id,
        location: makeLocation(node, this.filename),
        context: ReferenceContext.ASSIGNMENT_SOURCE,
        scope: funcPath,
        ast_node_id: `ast_read_${name}`,
      });
    }
  }

  /**
   * Process a call expression: emit CALLS/INSTANTIATES refs, return return-type path.
   */
  private processCallExpr(
    callNode: SyntaxNode,
    funcPath: string,
    localTypeMap: Map<string, string>
  ): string | null {
    const funcExpr = callNode.namedChildren[0];
    if (!funcExpr) return null;
    const argsNode = callNode.namedChildren[1]; // argument_list

    if (funcExpr.type === 'identifier') {
      const name = funcExpr.text;
      if (isBuiltin(name)) {
        // Process args but don't emit a call ref
        if (argsNode) {
          for (const arg of argsNode.namedChildren) {
            this.processExprForRefs(arg, funcPath, localTypeMap);
          }
        }
        return null;
      }

      const def = this.resolveSymbol(name);
      if (def) {
        if (def.kind === SymbolKind.CLASS) {
          this.refs.push({
            path: def.id,
            location: makeLocation(callNode, this.basename),
            context: ReferenceContext.INSTANTIATION,
            scope: funcPath,
            ast_node_id: `ast_new_${name}`,
          });
          // Process args
          if (argsNode) {
            for (const arg of argsNode.namedChildren) {
              this.processExprForRefs(arg, funcPath, localTypeMap);
            }
          }
          return def.id; // Instantiation returns the class type

        } else if (def.kind === SymbolKind.FUNCTION) {
          this.refs.push({
            path: def.id,
            location: makeLocation(callNode, this.basename),
            context: ReferenceContext.FUNCTION_CALL,
            scope: funcPath,
            ast_node_id: `ast_call_${name}`,
          });
          // Process args
          if (argsNode) {
            for (const arg of argsNode.namedChildren) {
              this.processExprForRefs(arg, funcPath, localTypeMap);
            }
          }
          const retType = def.metadata.get('return_type') as string | undefined;
          if (retType) return this.resolveTypeName(retType);
          return null;
        }
      }
      return null;

    } else if (funcExpr.type === 'attribute') {
      return this.processMethodCallExpr(callNode, funcExpr, funcPath, localTypeMap);
    }

    return null;
  }

  private processMethodCallExpr(
    callNode: SyntaxNode,
    attrNode: SyntaxNode,
    funcPath: string,
    localTypeMap: Map<string, string>
  ): string | null {
    const objNode = attrNode.namedChildren[0];
    const methodNode = attrNode.namedChildren[1];
    if (!objNode || !methodNode) return null;

    const methodName = methodNode.text;
    const argsNode = callNode.namedChildren[1];

    let objTypePath: string | null = null;

    if (objNode.text === 'self' && objNode.type === 'identifier') {
      // self.method()
      const currentClass = this.classScopeStack[this.classScopeStack.length - 1];
      if (currentClass) {
        const fullMethodPath = `file://${this.pathForIds}::${[...this.classScopeStack, methodName].join('.')}`;
        const methodDef = this.resolver.getById(fullMethodPath);
        if (methodDef) {
          this.refs.push({
            path: methodDef.id,
            location: makeLocation(callNode, this.basename),
            context: ReferenceContext.FUNCTION_CALL,
            scope: funcPath,
            ast_node_id: `ast_call_self_${methodName}`,
          });
          if (argsNode) {
            for (const arg of argsNode.namedChildren) {
              this.processExprForRefs(arg, funcPath, localTypeMap);
            }
          }
          const retType = methodDef.metadata.get('return_type') as string | undefined;
          return retType ? this.resolveTypeName(retType) : null;
        }
      }

    } else if (objNode.type === 'identifier') {
      // localVar.method()
      objTypePath = localTypeMap.get(objNode.text) ?? null;

      if (objTypePath) {
        const methodDef = this.resolver.findMethod(objTypePath, methodName);
        if (methodDef) {
          this.refs.push({
            path: methodDef.id,
            location: makeLocation(callNode, this.basename),
            context: ReferenceContext.FUNCTION_CALL,
            scope: funcPath,
            ast_node_id: `ast_call_${objNode.text}_${methodName}`,
          });
          if (argsNode) {
            for (const arg of argsNode.namedChildren) {
              this.processExprForRefs(arg, funcPath, localTypeMap);
            }
          }
          const retType = methodDef.metadata.get('return_type') as string | undefined;
          return retType ? this.resolveTypeName(retType) : null;
        }
      }

    } else if (objNode.type === 'attribute') {
      // self.attr.method()
      const outerObj = objNode.namedChildren[0];
      const outerAttr = objNode.namedChildren[1];
      if (outerObj?.text === 'self' && outerAttr) {
        const attrName = outerAttr.text;
        const currentClass = this.classScopeStack[this.classScopeStack.length - 1];
        if (currentClass) {
          const classAttrs = this.selfAttrMap.get(currentClass);
          objTypePath = classAttrs?.get(attrName) ?? null;
        }

        if (objTypePath) {
          const methodDef = this.resolver.findMethod(objTypePath, methodName);
          if (methodDef) {
            this.refs.push({
              path: methodDef.id,
              location: makeLocation(callNode, this.basename),
              context: ReferenceContext.FUNCTION_CALL,
              scope: funcPath,
              ast_node_id: `ast_call_self_${attrName}_${methodName}`,
            });
            if (argsNode) {
              for (const arg of argsNode.namedChildren) {
                this.processExprForRefs(arg, funcPath, localTypeMap);
              }
            }
            const retType = methodDef.metadata.get('return_type') as string | undefined;
            return retType ? this.resolveTypeName(retType) : null;
          }
        }
      }
    }

    return null;
  }

  // ─── Type & Symbol Resolution ─────────────────────────────────────────────

  /**
   * Infer the type path of an expression (used during self-attr pre-pass only).
   */
  private inferExprType(
    expr: SyntaxNode,
    _localTypeMap: Map<string, string>
  ): string | null {
    if (expr.type === 'call') {
      const fn = expr.namedChildren[0];
      if (!fn) return null;
      if (fn.type === 'identifier') {
        const def = this.resolveSymbol(fn.text);
        if (def?.kind === SymbolKind.CLASS) return def.id;
        if (def?.kind === SymbolKind.FUNCTION) {
          const retType = def.metadata.get('return_type') as string | undefined;
          return retType ? this.resolveTypeName(retType) : null;
        }
      }
    } else if (expr.type === 'identifier') {
      const def = this.resolveSymbol(expr.text);
      if (def?.kind === SymbolKind.CLASS) return def.id;
    }
    return null;
  }

  private resolveSymbol(name: string): SymbolDef | null {
    // 0. Local variable or parameter in current function — do not resolve to other files
    if (this.currentLocals.has(name)) return null;

    // 1. Import table (only way to refer to symbols in other files in Python)
    const importedPath = this.importTable.get(name);
    if (importedPath) return this.resolver.getById(importedPath) ?? null;

    // 2. Current file (module/class/function scope definitions)
    const localPath = `file://${this.pathForIds}::${name}`;
    const local = this.resolver.getById(localPath);
    if (local) return local;

    // Do not resolve by name across the codebase — Python has no magical cross-file names
    return null;
  }

  private resolveTypeName(typeName: string): string | null {
    const def = this.resolveSymbol(typeName);
    return def ? def.id : null;
  }
}
