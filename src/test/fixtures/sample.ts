// Sample TypeScript file for AST parser testing

interface MyInterface {
  property: string;
  method(): number;
}

type MyType = {
  name: string;
  age: number;
};

function helloWorld(): string {
  return 'Hello, world!';
}

class MyClass {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  greet(): string {
    return `Hello, ${this.name}!`;
  }
}

const myObject: MyType = {
  name: 'test',
  age: 25,
};

export function exportedFunction(): string {
  return 'exported';
}

export class ExportedClass {
  constructor() {}
}

// Import/export examples
import { someFunction } from './otherModule';
import defaultImport from './defaultModule';

export * from './reexportModule';
export { something } from './namedExportModule';
