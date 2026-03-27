# Changelog

## 0.1.0 (2026-03-27)

Initial release.

### Features

- **HTTP Interceptor** — monkey-patches `http.createServer` to capture Server Action requests and responses transparently. Works with any RSC framework (Next.js, Waku, Parcel, custom servers).
- **FormData Parser** — full multipart/form-data parsing with support for:
  - Bracket notation (`user[name]` → nested objects)
  - Array notation (`tags[]`, `items[0]` → arrays)
  - Duplicate keys → arrays
  - File fields → stub objects (no binary storage)
  - JSON value auto-parsing
  - Framework prefix separation (`$ACTION_ID_`, `$ACTION_REF_` → metadata)
  - Programmatic invocation detection (numbered prefix args)
  - Checkbox field detection
  - Framework auto-detection from FormData patterns
- **Fixture Store** — saves each captured action as `.json` (data) + `.meta.json` (metadata). Overwrites on same action ID.
- **MSW Generator** — generates MSW 2.x handlers that match `Next-Action` header. Supports single handler and combined module generation.
- **Type Generator** — infers TypeScript interfaces (form invocations) or tuple types (programmatic invocations) from fixture input. JSDoc output supported.
- **Diff** — structural comparison of fixture input fields. Output (RSC Payload) compared by hash, with `--full` option for line-by-line diff.
- **Watch Mode** — `rsctape mock --watch` auto-regenerates MSW handlers when fixtures change.
- **CLI** — `rsctape init`, `list`, `mock`, `diff`, `types`, `delete` commands.
- **Framework Detection** — auto-detects Next.js, Waku, Parcel from package.json and config files.
- **Environment Safety** — only activates when `NODE_ENV=development` or `RSCTAPE_ENABLED=true`. Zero overhead in production.
- **Error Isolation** — interceptor errors never affect the original request/response flow.
- **api-tape Integration** — uses api-tape for `ConfigError`, `sanitizeName`, `diffObjects`, `formatDiffResult`, `hashValue`, `inferType`, `toPascalCase`.

### Correctness Properties (PBT)

13 formally specified correctness properties verified with property-based testing (fast-check):

| Property | Description |
|----------|-------------|
| P1 | Interception transparency — request/response data unchanged |
| P2 | Selective interception — only `Next-Action` requests captured |
| P3 | FormData parse round-trip consistency |
| P4 | Framework prefix isolation — `$ACTION_ID_`/`$ACTION_REF_` in metadata only |
| P5 | Fixture storage integrity — save-load round-trip |
| P6 | Fixture overwrite idempotency |
| P7 | MSW handler correct matching |
| P8 | MSW handler response fidelity |
| P9 | Environment safety — no patching outside development |
| P10 | Streamed response completeness |
| P11 | Config fault tolerance |
| P12 | File field safety — no binary content in fixtures |
| P13 | Error isolation — interceptor errors don't break requests |
