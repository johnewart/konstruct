# konstruct-sdk

Types and contract for [Konstruct](https://github.com/johnewart/konstruct) plugins.

## Plugin contract

- **Package name**: `konstruct-plugin-<id>` (e.g. `konstruct-plugin-example`).
- **Entry**: main export must provide a `register` function (or default export).

### Backend: `register(api)`

The host calls `register(api)` with:

- **registerTool(name, fn)** – Register a tool runner. `fn(args, context)` returns `ToolResult`.
- **addToolDefinitions(defs)** – Add tool definitions (name, description, parameters) for the model.
- **config** – Global Konstruct config (read-only).
- **pluginConfig** – Top-level config key for this plugin (e.g. `config[pluginId]`).
- **registerRouter(name, router)** – Mount a tRPC router under `plugins.<name>`.

### Optional: settings panel

Export a React component as the **default** from the `settings` subpath (e.g. `konstruct-plugin-example/settings`).  
The host renders it with:

- **pluginId** – Plugin id.
- **projectId** – Current workspace (project) id; settings are per workspace.
- **settings** – Current settings object (read-only snapshot).
- **onSave(settings)** – Persist new settings for this workspace.

Add a corresponding entry in the app’s plugin settings import map so the host can load your component.

### Optional: sidebar view

Export a view from your package (e.g. `konstruct-plugin-jira/view`) with `path`, `label`, and default React component.  
Register it in the app’s plugin view import map.

## Types

- `ToolDefinition`, `ToolResult`, `ToolContext`, `ToolRunner`
- `KonstructPluginApi`, `KonstructPluginConfig`
- `PluginSettingsProps` (for the settings panel component)

## Usage

```ts
import type { KonstructPluginApi, ToolDefinition } from 'konstruct-sdk';

export function register(api: KonstructPluginApi) {
  const { registerTool, addToolDefinitions } = api;
  addToolDefinitions([{ type: 'function', function: { name: 'my_tool', description: '...', parameters: {} } }]);
  registerTool('my_tool', (args) => ({ result: 'ok' }));
}
```

Install as a dependency (or peer) in your plugin package:

```bash
npm install konstruct-sdk
```
