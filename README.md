# Konstruct

An intelligent coding assistant that helps you build, understand, and maintain software projects through conversational agent interactions. Konstruct analyzes your codebase, executes tools, and provides real-time feedback using a three-tier architecture (Client ↔ Server ↔ Agent).

## Overview

Konstruct combines the power of large language models with practical development workflows. It:

- Analyzes your codebase using tree-sitter for AST parsing
- Supports multiple LLM providers (Amazon Bedrock, Anthropic)
- Executes tools in real-time (code generation, documentation, testing)
- Maintains conversation sessions with plan and design document storage
- Provides a modern React-based interface for interactive development

## Architecture

Konstruct uses a **Client ↔ Server ↔ Agent** architecture:

```
┌─────────────┐    WebSocket    ┌──────────────┐    HTTP/WS    ┌──────────────┐
│   Client    │◄────────────────┤   Server     │──────────────►│    Agent     │
│ (React UI)  │    tRPC/Stream  │ (Elysia)     │    HTTP       │ (Bun Worker) │
└─────────────┘                 └──────────────┘               └──────────────┘
      │                                │                              │
      │  User interactions             │  tRPC endpoints                │
      │  UI updates                    │  Document/Session API          │
      │                                │                              │
      └────────────── tRPC calls ──────┘                              │
                                                                      │
                                              ┌───────────────────────┘
                                              │ Agent loop execution
                                              │ - Tool selection
                                              │ - Code execution
                                              │ - LLM interaction
                                              └───────────────────────┘
```

### Components

- **Client**: React application with Mantine UI, handles user interactions and displays results
- **Server**: Elysia-based backend with tRPC endpoints for API communication, manages sessions and documents
- **Agent**: Separate worker process running the LLM + tool loop, communicates with server via WebSocket for real-time updates

## Project Structure

```
src/
├── client/           # Client-side tRPC hooks and configuration
├── backend/          # Elysia server, tRPC routers, services
│   ├── routers/      # API route handlers (chat, documents, sessions, runpod)
│   ├── trpc/         # tRPC setup (router, context, types)
│   └── services/     # Business logic services
├── agent/            # Agent worker process
│   ├── tools/        # Tool definitions and executors
│   ├── runLoop.ts    # Main agent loop (LLM + tools)
│   └── modes.ts      # Agent operation modes
├── frontend/         # React client application
│   ├── components/   # React components
│   ├── pages/        # Page components
│   └── lib/          # Frontend utilities
├── shared/           # Shared utilities and types
│   ├── llm.ts        # LLM provider integration
│   ├── sessionStore.ts  # Session persistence
│   ├── documentStore.ts # Document management
│   ├── ast.ts        # Tree-sitter AST utilities
│   └── codebaseOutline.ts # Codebase analysis
└── test/             # Test files
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (runtime and package manager)
- Node.js (optional, for some development tooling)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd konstruct-web
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Configure environment variables**
   
   Copy `.env.example` to `.env` and configure your LLM provider:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

### Running the Application

#### Option 1: Using Bun and `concurrently` (Recommended)

Start both server and Vite dev server together:

```bash
bun run dev
```

This runs:
- Server on `http://localhost:3001`
- Vite dev server (usually `http://localhost:5173`)

#### Option 2: Using Overmind (Procfile)

If you have [Overmind](https://github.com/DarthSim/overmind) installed:

```bash
# Start with Overmind
om start

# Or run individual processes
om run server    # Runs the Elysia server
om run ui        # Runs Vite dev server
om run agent     # Runs the agent worker
```

#### Option 3: Using Foreman

If you have [Foreman](https://github.com/strongloop/node-foreman) installed:

```bash
nf start
```

#### Option 4: Manual Start

Start each component separately in different terminals:

**Terminal 1 - Server:**
```bash
bun run server
```

**Terminal 2 - Vite Dev Server:**
```bash
bun run dev
```

**Terminal 3 - Agent (if running separately):**
```bash
bun run agent
```

### Build for Production

```bash
# Build the frontend
bun run build

# Preview the production build
bun run preview
```

## Development

### Linting and Formatting

```bash
# Lint TypeScript/TSX files
bun run lint

# Auto-fix linting issues
bun run lint:fix

# Format all files
bun run format

# Check formatting without modifying
bun run format:check
```

### Testing

```bash
# Run tests
bun run test

# Watch mode
bun run test:watch

# With coverage
bun run test:coverage
```

### Tree-sitter Patches

The project uses patched versions of tree-sitter for bug fixes. Apply patches with:

```bash
bun run apply-tree-sitter-patches
```

## How It Works

### 1. Client ↔ Server Communication

The React client communicates with the server using **tRPC** (type-safe RPC):

- **tRPC Endpoints**: `/trpc/*` routes for all API calls
- **WebSocket**: `/agent-stream` for real-time agent progress updates
- **Document API**: `/api/doc`, `/api/docs` for plan/design management

### 2. Server ↔ Agent Communication

The server communicates with the agent via **WebSocket**:

- Agent runs as a separate `bun run` process
- Server pushes agent progress to clients via `/agent-stream` WebSocket
- Agent maintains its own session storage in `.konstruct/sessions.json`

### 3. Agent Loop

The agent follows this workflow:

1. **Parse input** - Analyze user message and determine tool needs
2. **Tool selection** - Choose appropriate tools from available options
3. **Tool execution** - Run tools (code generation, AST parsing, etc.)
4. **LLM interaction** - Send results to LLM for processing
5. **Response generation** - Formulate response and update session
6. **Progress reporting** - Send updates to server via WebSocket

### Available Tools

- **Executor**: Executes code in the project environment
- **Runners**: Project-specific task runners
- **AST Parser**: Analyzes source code structure
- **Dependency Graph**: Maps project dependencies

### LLM Providers

- **Amazon Bedrock**: Configure via AWS credentials
- **Anthropic**: Configure via API key

## Configuration

### Agent Configuration

Set environment variables in `.env`:

```env
# Agent settings
AGENT_PORT=3002          # Port for agent WebSocket
SERVER_URL=http://localhost:3001  # Server URL for WebSocket connection
PROJECT_ROOT=/path/to/project     # Project root directory
```

### Server Configuration

```env
# Server settings
PORT=3001                # Server port
NODE_ENV=development     # Environment
```

## License

Copyright 2026 John Ewart <john@johnewart.net>

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
