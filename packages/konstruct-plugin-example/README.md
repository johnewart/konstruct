# konstruct-plugin-example

Example [Konstruct](https://github.com/johnewart/konstruct) plugin. Use it as a reference or copy it as a template for your own plugin.

## What it does

- Registers one tool, `example_echo(message)`, that echoes the message back.
- Optionally provides a **settings** panel (per-workspace “Example message”).
- Plugin ID is `example` (from the package name `konstruct-plugin-example`).

## Package layout

| Entry point      | Purpose |
|------------------|--------|
| `main` / `.`     | Backend: `register(api)` — register tools and optional tRPC routers. Loaded by the Konstruct server. |
| `./settings`     | Frontend: default export is a React settings component. Loaded by the app when the user opens plugin settings. |
| `./view` (optional) | Frontend: export `path`, `label`, and default React component for a sidebar view. This example does not provide one. |

The host loads plugins by convention: package name must be `konstruct-plugin-<id>`. It discovers installed `konstruct-plugin-*` packages from the app’s `package.json` and loads only those listed in config.

## Build

This example is plain JavaScript and does not require a build step. If you build a plugin in TypeScript or with a bundler, add a `build` script and run it before publishing or linking.

## Install (in the Konstruct app)

**From this repo (monorepo):**  
The app already depends on this package via `file:./packages/konstruct-plugin-example`. From the repo root:

```bash
npm install
```

**As a local path (your own plugin):**

```bash
cd /path/to/konstruct-web
npm install /path/to/konstruct-plugin-example
```

Or in the app’s `package.json`:

```json
"dependencies": {
  "konstruct-plugin-example": "file:../path/to/konstruct-plugin-example"
}
```

Then run `npm install`.

**From npm (if published):**

```bash
npm install konstruct-plugin-example
```

## Enable the plugin

Add the plugin ID to your Konstruct config (`~/.config/konstruct/config.yaml` or project config):

```yaml
plugins:
  enabled:
    - example
```

Restart the Konstruct server so it loads the plugin. After that, the example tool is available to the agent and the Settings UI shows a “Settings” button for the plugin (which opens the optional settings panel).

## Creating your own plugin

1. Copy this package and rename it (e.g. `konstruct-plugin-mything`).
2. In `package.json`: set `"name": "konstruct-plugin-mything"` and update `description`.
3. In your config: add `mything` to `plugins.enabled`.
4. Implement `register(api)` in the main entry; optionally add `./settings` and/or `./view` exports.
5. Depend on `konstruct-sdk` only if you need TypeScript types; the runtime contract is the `register(api)` shape and optional export paths above.
