// Sample JavaScript file for AST parser testing

function helloWorld() {
  console.log("Hello, world!");
}

class MyClass {
  constructor(name) {
    this.name = name;
  }
  
  greet() {
    return `Hello, ${this.name}!`;
  }
}

const myObject = {
  property: "value",
  method() {
    return "method result";
  }
};

export function exportedFunction() {
  return "exported";
}

export class ExportedClass {
  constructor() {}
}

// Import/export examples
import { someFunction } from "./otherModule";
import defaultImport from "./defaultModule";

export * from "./reexportModule";
export { something } from "./namedExportModule";