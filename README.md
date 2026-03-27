<div align="center">

# 📼 rsc-tape

**Record React Server Actions. Replay them with MSW.**

[![npm version](https://img.shields.io/npm/v/rsc-tape.svg?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rsc-tape)
[![license](https://img.shields.io/npm/l/rsc-tape.svg?style=flat-square&color=blue)](./LICENSE)
[![node](https://img.shields.io/node/v/rsc-tape.svg?style=flat-square&color=339933)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![MSW](https://img.shields.io/badge/MSW-2.x-ff6a33?style=flat-square)](https://mswjs.io)
[![api-tape](https://img.shields.io/badge/companion-api--tape-8b5cf6?style=flat-square)](https://www.npmjs.com/package/api-tape)

*Capture every Server Action from Next.js, Waku, Parcel, or any RSC server — zero config, zero framework hooks.*

</div>

---

## ✨ Why rsc-tape?

Testing Server Actions is painful. You need real responses to write meaningful tests, but manually crafting RSC payloads is tedious and error-prone.

rsc-tape solves this by **recording real interactions** from your dev server and **generating MSW handlers** you can drop straight into your test suite.

```
Dev Server → rsc-tape records → JSON fixtures → MSW handlers → Your tests
```

## 🚀 Quick start

```bash
npm install rsc-tape --save-dev
```

```bash
npx rsctape init          # Generate config + framework entry point
# ... start dev server, use your app ...
npx rsctape mock -o ./src/mocks/handlers.ts   # Generate MSW handlers
```

**That's it.** Your test suite now has real Server Action mocks.

---

## 📦 Framework setup

<details>
<summary><strong>Next.js</strong></summary>

Add to `instrumentation.ts` (created by `rsctape init`):

```typescript
export async function register() {
  if (process.env.NODE_ENV === 'development') {
    const { register } = await import('rsc-tape');
    register();
  }
}
```

</details>

<details>
<summary><strong>Waku</strong></summary>

Add to your entry point:

```javascript
if (process.env.NODE_ENV === 'development') {
  const { register } = require('rsc-tape');
  register();
}
```

</details>

<details>
<summary><strong>Custom server</strong></summary>

```javascript
const { register } = require('rsc-tape');
register();
// ... your http.createServer() call
```

</details>

> 💡 rsc-tape only activates when `NODE_ENV=development` or `RSCTAPE_ENABLED=true`. **Zero overhead in production.**

---

## 🛠 CLI

| Command | Description |
|:--------|:------------|
| `rsctape init` | 🔍 Detect framework, generate config and entry point |
| `rsctape list` | 📋 List all captured fixtures |
| `rsctape mock -o file.ts` | ⚡ Generate MSW handlers |
| `rsctape mock -o file.ts --watch` | 👀 Auto-regenerate on fixture changes |
| `rsctape diff <id1> <id2>` | 🔄 Compare two fixtures (input fields) |
| `rsctape diff <id1> <id2> --full` | 📝 Include RSC Payload line-by-line diff |
| `rsctape types` | 🏷️ Generate TypeScript types from fixtures |
| `rsctape types --jsdoc` | 📄 Generate JSDoc types instead |
| `rsctape delete <id>` | 🗑️ Delete a fixture |

### Common flags

```
-d, --dir <path>       Override fixture directory
-o, --output <path>    Output file (mock)
--actions <ids...>     Filter by action IDs (mock)
--full                 Full output diff (diff)
--jsdoc                JSDoc output (types)
-w, --watch            Watch mode (mock)
```

---

## ⚙️ How it works

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Browser     │────▶│  Node.js     │────▶│  Your App    │
│  Client      │     │  HTTP Server │     │  Handler     │
└─────────────┘     └──────┬───────┘     └──────────────┘
                           │
                    ┌──────▼───────┐
                    │  rsc-tape    │  ← monkey-patches http.createServer
                    │  interceptor │
                    └──────┬───────┘
                           │
              ┌────────────▼────────────┐
              │  Next-Action header?    │
              │  Yes → buffer & save    │
              │  No  → pass through     │
              └─────────────────────────┘
```

1. `register()` patches `http.createServer` to wrap your request handler
2. Checks each request for the `Next-Action` header (RSC protocol standard)
3. Buffers request body + response chunks **without modifying them**
4. After `res.end()`, asynchronously parses FormData and saves fixtures
5. `rsctape mock` reads fixtures and generates MSW handlers

> The interceptor is **purely observational** — it never modifies request or response data.

---

## 📁 Configuration

`rsctape.config.json`:

```json
{
  "fixtureDir": "./fixtures/actions",
  "ignore": ["**/internal-*"]
}
```

| Field | Default | Description |
|:------|:--------|:------------|
| `fixtureDir` | `./fixtures/actions` | Where fixtures are saved |
| `ignore` | `[]` | Glob patterns for action IDs to skip |

### Environment variables

| Variable | Effect |
|:---------|:-------|
| `NODE_ENV=development` | Enable interception (default) |
| `RSCTAPE_ENABLED=true` | Force enable regardless of NODE_ENV |
| `RSCTAPE_VERBOSE=true` | Log each captured action to console |

---

## 📼 Fixture format

Each Server Action produces two files:

<table>
<tr>
<td>

**`{actionId}.json`**

```json
{
  "input": {
    "username": "alice",
    "profile": {
      "age": 25,
      "city": "Taipei"
    }
  },
  "output": "0:{\"result\":\"ok\"}\n"
}
```

</td>
<td>

**`{actionId}.meta.json`**

```json
{
  "actionId": "abc123def",
  "url": "/",
  "method": "POST",
  "statusCode": 200,
  "contentType": "text/x-component",
  "timestamp": "2024-01-15T10:30:00Z",
  "formDataMetadata": {
    "invocationType": "form",
    "frameworkHint": "next"
  }
}
```

</td>
</tr>
</table>

---

## ⚡ Generated MSW handlers

```typescript
import { http, HttpResponse } from 'msw';

/** Handler for action: abc123 */
export const handle_abc123 = http.post('*', ({ request }) => {
  if (request.headers.get('Next-Action') !== 'abc123') return;
  return new HttpResponse(`0:{"result":"ok"}\n`, {
    headers: { 'Content-Type': 'text/x-component' },
  });
});

export const handlers = [handle_abc123];
```

> Handlers use `http.post('*')` with header matching because Server Action URLs vary by framework — the `Next-Action` header is the stable identifier.

---

## 🏷️ Type generation

`rsctape types` infers types from fixture data:

| Invocation type | Output |
|:----------------|:-------|
| Form submission | TypeScript `interface` from form fields |
| Programmatic call | TypeScript `tuple` from serialized args |

```typescript
// Form submission → interface
export interface CreateUserInput {
  username: string;
  age: number;
}

// Programmatic call → tuple
export type UpdateProfileInput = [string, Record<string, unknown>];
```

---

## 🔍 FormData parsing

rsc-tape handles the full complexity of Server Action FormData:

| Pattern | Result |
|:--------|:-------|
| `user[name]` | `{ user: { name: "..." } }` |
| `tags[]` | `["a", "b"]` |
| `items[0]`, `items[1]` | `["first", "second"]` |
| Duplicate keys | Collected as arrays |
| File fields | `{ __type: "file", name, type, size }` |
| JSON string values | Auto-parsed |
| `$ACTION_ID_`, `$ACTION_REF_` | Separated into metadata |
| `1_$ACTION_ID_xxx` | Ordered args array |

---

## 🔄 Diff

Action IDs change on HMR/recompile, but old fixtures stay on disk:

```bash
rsctape diff abc123 def456          # Input structure diff
rsctape diff abc123 def456 --full   # + RSC Payload line diff
```

---

## 💻 Programmatic API

```typescript
import { register, createHandler, generateHandlers, detectFramework } from 'rsc-tape';

register({ fixtureDir: './my-fixtures', verbose: true });

const code = createHandler('actionId', fixture);

const module = await generateHandlers({
  fixtureDir: './fixtures/actions',
  outputPath: './handlers.ts',
});

const framework = await detectFramework(); // 'next' | 'waku' | 'parcel' | 'unknown'
```

---

## 🤝 Relationship to api-tape

rsc-tape is the RSC companion to [api-tape](https://www.npmjs.com/package/api-tape). It reuses api-tape's core utilities (diff, type inference, sanitization) and adds Server Action-specific logic: HTTP interception, FormData parsing, and `Next-Action` header-based MSW handlers.

---

## 📖 More

- [**Guide**](./GUIDE.md) — step-by-step walkthrough with troubleshooting
- [**Changelog**](./CHANGELOG.md) — release history

## 📄 License

[MIT](./LICENSE)
