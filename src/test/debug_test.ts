import { describe, it } from 'vitest';
import { buildDependencyGraph } from './src/shared/dependencyGraph';

describe('debug', () => {
  it('debug imports', () => {
    const src = `
import { func1 } from './module1';
import * as module2 from './module2';
import module3 from './module3';
import './module4';
export function test() { return func1(); }`;
    const graph = buildDependencyGraph(src, 'js', '/test/main.js');
    console.log('IMPORT EDGES:');
    graph.edges.forEach(e => console.log(JSON.stringify(e)));
  });
  
  it('debug require', () => {
    const src2 = `
const module1 = require('./module1');
const { func1 } = require('./module2');
const module3 = require('external-module');
module.exports = { func: function() {} };`;
    const graph2 = buildDependencyGraph(src2, 'js', '/test/main.js');
    console.log('REQUIRE EDGES:');
    graph2.edges.forEach(e => console.log(JSON.stringify(e)));
  });

  it('debug exports', () => {
    const src3 = `
export function func1() {}
export const const1 = 'value';
export class Class1 {}
export { func1 as renamedFunc } from './module';
export * from './module2';
export default function() {}`;
    const graph3 = buildDependencyGraph(src3, 'js', '/test/main.js');
    console.log('EXPORT EDGES (' + graph3.edges.length + ' total):');
    graph3.edges.forEach(e => console.log(JSON.stringify(e)));
  });
});
