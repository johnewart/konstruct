/*
 * Copyright 2026 John Ewart <john@johnewart.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Dependency graph types. When the graph is built for the UI (e.g. PR page),
 * edge targets are normalized to actual file paths (with extension) so that
 * matching edge.target === activeFile for inbound/outbound works. Stored
 * paths are repo-relative after stripping in the codebase router.
 */

/** Node in the dependency graph. */
export interface DependencyNode {
  path: string;
  name: string;
  type: 'file' | 'module';
}

/** Edge (import/export/require) between nodes. Target should be actual file path with extension for inbound matching. */
export interface DependencyEdge {
  source: string;
  target: string;
  type: 'import' | 'export' | 'require';
  identifier?: string;
}

/** Full dependency graph. */
export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}
