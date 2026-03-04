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

import type { ToolDefinition } from '../shared/llm';
import { getMode } from './modes';

const ALL_TOOL_DEFS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description:
        'List files in a directory. Use to explore project structure.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path relative to project root',
          },
          glob: {
            type: 'string',
            description: 'Optional glob filter (e.g. *.go)',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file_region',
      description:
        'Read a range of lines from a file (1-based). Prefer 50-100 lines at a time for useful context; if you need more of the file, use increasingly larger ranges on the next read (e.g. 100-150, then 200+ lines) rather than many small reads. Use before edit_file to get exact content. Max 400 lines per call.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to project root',
          },
          start_line: { type: 'number', description: 'First line (1-based)' },
          end_line: {
            type: 'number',
            description:
              'Last line (1-based); prefer 50-100+ lines, or larger (up to 400) when you need more context',
          },
        },
        required: ['path', 'start_line', 'end_line'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description:
        'Search for regex pattern in files. Returns file:line:content.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern' },
          path: {
            type: 'string',
            description: 'Directory or file (default .)',
          },
          context: {
            type: 'number',
            description: 'Lines of context around match (default 0)',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description: 'Find files whose base name matches a glob pattern.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (e.g. *.go)' },
          path: {
            type: 'string',
            description: 'Directory to search (default .)',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'codebase_outline',
      description:
        'Get a compact, LLM-friendly outline of the codebase (functions, classes, methods with line numbers). Works for JS/TS/JSX/TSX/Python. Use to understand file structure before reading. Path can be a file or directory; optional glob (e.g. *.ts) filters files.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File or directory path relative to project root',
          },
          glob: {
            type: 'string',
            description: 'Optional glob filter (e.g. *.ts, *.py)',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Search for code pattern (regex) in files.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern' },
          path: {
            type: 'string',
            description: 'Directory or file (default .)',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Replace one exact occurrence of old_string with new_string. Use read_file_region first to get exact content.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to project root',
          },
          old_string: {
            type: 'string',
            description: 'Exact string to replace (must appear once)',
          },
          new_string: { type: 'string', description: 'Replacement string' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file with content.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to project root',
          },
          content: { type: 'string', description: 'File content' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Run a shell command in the project directory (e.g. tests, builds).',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getGitDiff',
      description: 'Get line-by-line git diff of all changed files in the repository. Returns structured diff with line numbers and types (add/remove/context).',
      parameters: {
        type: 'object',
        properties: {
          repoPath: {
            type: 'string',
            description: 'Path to git repository (default: project root)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_plan',
      description: 'Create a plan file in .konstruct/plans directory.',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'Filename (no path separators)',
          },
          content: { type: 'string', description: 'Plan content (markdown)' },
        },
        required: ['filename', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_design',
      description: 'Create a design file in .konstruct/designs directory.',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'Filename (no path separators)',
          },
          content: { type: 'string', description: 'Design content (markdown)' },
        },
        required: ['filename', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_plan',
      description:
        'Edit a plan file in .konstruct/plans. Use read_file_region first to get exact content.',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'Filename (no path separators)',
          },
          old_string: {
            type: 'string',
            description: 'Exact string to replace',
          },
          new_string: { type: 'string', description: 'Replacement string' },
        },
        required: ['filename', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_design',
      description:
        'Edit a design file in .konstruct/designs. Use read_file_region first to get exact content.',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'Filename (no path separators)',
          },
          old_string: {
            type: 'string',
            description: 'Exact string to replace',
          },
          new_string: { type: 'string', description: 'Replacement string' },
        },
        required: ['filename', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_status',
      description:
        "Declare what you are doing right now (e.g. 'Reading foo.go', 'Editing bar.ts'). Call this before tool use so the work log shows progress. Then call tools WITHOUT chat text.",
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'Short description of current activity',
          },
        },
        required: ['description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'suggest_relevant_file',
      description:
        'Add a file path to the review context so the user sees it in the "Assistant suggestions" panel. Use when a file is relevant to the review even if it is not in the dependency graph (e.g. tests, config, or related code you looked at). Path should be relative to the project root.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to project root',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'suggest_improvement',
      description:
        'Record a concrete code improvement suggestion for the user. Use when you want to suggest a specific change (e.g. use const instead of var, add error handling, simplify logic). The suggestion appears in the "Suggested improvements" panel. Path relative to project root; lineNumber is 1-based; snippet is optional example replacement code.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'File path relative to project root',
          },
          line_number: {
            type: 'number',
            description: 'Optional 1-based line number the suggestion refers to',
          },
          suggestion: {
            type: 'string',
            description: 'Clear, actionable suggestion (what to change and why)',
          },
          snippet: {
            type: 'string',
            description: 'Optional: example code showing the suggested change',
          },
        },
        required: ['file_path', 'suggestion'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_todos',
      description:
        "List the session's todo items (id, description, status: pending|in_progress|completed).",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_todo',
      description: "Add a todo to the session's list.",
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Todo description' },
        },
        required: ['description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_todo',
      description: "Update a todo's status (pending, in_progress, completed).",
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Todo id from list_todos' },
          status: {
            type: 'string',
            description: 'pending, in_progress, or completed',
          },
        },
        required: ['id', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_session_title',
      description:
        'Update the title of the current chat session. Use a concise, descriptive title that captures the essence of the task.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'The new title for the chat session',
          },
        },
        required: ['title'],
      },
    },
  },
];

const toolsByName = new Map<string, ToolDefinition>();
for (const t of ALL_TOOL_DEFS) {
  toolsByName.set(t.function.name, t);
}

export function getToolsForMode(modeId: string): ToolDefinition[] {
  const mode = getMode(modeId);
  const names = mode?.toolNames ?? getMode('implementation')!.toolNames;
  return names
    .map((name) => toolsByName.get(name))
    .filter(Boolean) as ToolDefinition[];
}

export const IMPLEMENTER_TOOLS = getToolsForMode('implementation');
