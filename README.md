# Apple Container Manager

A native macOS desktop application for managing Apple Container, built with [Tauri](https://tauri.app/) v2, React, and TypeScript.

## Features

### Container Management
- List all containers with real-time status
- Start, stop, delete, and kill containers
- View container logs in Terminal.app
- Execute shell commands in running containers
- View resource usage (CPU, Memory, Block I/O)
- Batch operations (select multiple containers)
- Filter by ID, image name, IP, or state

### Image Management
- List all container images with size information
- Pull images with progress indicator
- Build images from Dockerfile
- Delete images (with usage detection)
- Verbose mode showing architectures and default commands
- Filter by name, tag, or digest
- Batch delete operations

### Volume Management
- Create and delete volumes
- View volume details and disk usage

### Network Management
- Create and delete networks
- View network configuration

### Machine Management
- Create container machines with custom resources
- Start, stop, and delete machines
- View machine details (CPUs, memory, disk)
- Inspect machine configuration

## Tech Stack

- **Backend**: Rust with Tauri v2
- **Frontend**: React 19 + TypeScript + Vite
- **Styling**: Custom CSS with CSS variables
- **Build**: Tauri CLI for native macOS app

## Prerequisites

- macOS 15 or later
- Apple Container installed (`/usr/local/bin/container`)
- Node.js 20+
- Rust toolchain
- pnpm

## Installation

### From DMG (Recommended)

Download the latest release from GitHub Releases and drag the app to your Applications folder.

### From Source

```bash
# Clone the repository
git clone https://github.com/yourusername/apconui.git
cd apconui

# Install dependencies
pnpm install

# Start development mode
pnpm dev

# In another terminal, start Tauri
cd src-tauri
cargo run
```

### Build for Distribution

```bash
# Build frontend
pnpm build

# Build native app
cd src-tauri
cargo tauri build --bundles app

# The app will be in target/release/bundle/macos/
```

## Development

The app uses a two-process architecture:

1. **Frontend** (React): Runs in a webview, handles UI
2. **Backend** (Rust/Tauri): Executes container commands, manages system interactions

### Commands

```bash
pnpm dev          # Start Vite dev server
pnpm build        # Build frontend for production
pnpm lint         # Run ESLint
cargo tauri build # Build native app
```

## Architecture

```
apconui/
├── src/                  # React frontend
│   ├── App.tsx          # Main application
│   ├── App.css          # Styles
│   └── main.tsx         # Entry point
├── src-tauri/            # Rust backend
│   ├── src/
│   │   ├── lib.rs       # Tauri commands
│   │   └── main.rs      # Entry point
│   ├── Cargo.toml       # Rust dependencies
│   └── tauri.conf.json  # Tauri configuration
└── package.json
```

## License

MIT
