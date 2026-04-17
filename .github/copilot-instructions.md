# Copilot Instructions

## Project Overview

Pointer as a Service turns a smartphone into a wireless presentation remote for PowerPoint. The system uses **Azure Web PubSub** (Client Protocol) for real-time communication between a PowerPoint Office Add-in (host) and a mobile browser (controller). No app install or Bluetooth pairing needed — just internet.

## Architecture

The project is migrating from ASP.NET Core 2.2 + Azure SignalR to a **static frontend + Azure Web PubSub + Azure Static Web Apps** architecture.

### Current (Legacy): `src/aspnetcore/`

ASP.NET Core 2.2 MVC with SignalR. Retained as reference during migration.

### New Architecture

```
src/
├── terraform/        # Azure infrastructure (IaC)
├── functions/        # Azure Functions (Node.js TypeScript) — negotiate endpoint
└── static-webapp/    # Static HTML + CSS + JS frontend
```

- **Static Web App** (`src/static-webapp/`): Vanilla HTML + CSS + JS. Two pages:
  - `index.html` — Host/Office Add-in Task Pane (QR code, slide sync, PowerPoint API)
  - `control.html` — Mobile controller (swipe navigation, speaker notes, slide preview)
- **Azure Functions** (`src/functions/`): Single `negotiate` function that generates Web PubSub client access URLs with group permissions.
- **Azure Web PubSub**: Client Protocol (`json.webpubsub.azure.v1`) enables direct client-to-client group messaging without server involvement.
- **Terraform** (`src/terraform/`): Manages Azure resources (SWA, Web PubSub, Function App).

### Communication Flow

1. Host calls `/api/negotiate?id={token}` → gets Web PubSub client URL with group permissions
2. Both host and controller `joinGroup(token)` and `sendToGroup(token, command)`
3. Commands: `First`, `Prev`, `Next`, `GoToSlide`, `SlideChanged`, `UpdateStatus`, `AllSlides`

## Build & Run

### Functions (Node.js TypeScript)

```bash
cd src/functions
npm install
npm run build
npm start           # Requires Azure Functions Core Tools
```

### Static Web App

No build step — serve `src/static-webapp/` with any static file server:

```bash
cd src/static-webapp
npx serve .         # or python -m http.server
```

### Terraform

```bash
cd src/terraform
terraform init
terraform plan -var="subscription_id=YOUR_SUB_ID"
terraform apply -var="subscription_id=YOUR_SUB_ID"
```

### Legacy ASP.NET Core

```bash
cd src/aspnetcore
libman restore
dotnet run
```

## Key Conventions

- **No npm bundler** for frontend — vanilla JS with CDN dependencies
- **CDN dependencies**: `@azure/web-pubsub-client`, `nipplejs`, `qrcode-generator`, `Office.js`
- **Theme**: Light/Dark/Follow System via CSS variables + `localStorage`
- **Office Add-in manifests** live in `manifest/` — template uses `{{BASE_URL}}` placeholder
- **Token-based grouping**: Host generates UUID token, encodes in QR code URL, controller scans to join same Web PubSub group
- **PowerPoint APIs**: Notes (PowerPointApi 1.3+), Thumbnails (PowerPointApi 1.4+)
- **PWA**: Controller page supports Add to Home Screen via `manifest.json` + Service Worker
- **GitHub Actions**: `provision-infrastructure.yml` (Terraform + Functions), `deploy-webapp.yml` (SWA + manifest)

