# package-reality-check

[![M8ven Verified](https://m8ven.ai/badge/mcp/only-abhiram-check-package-mcp-server-jxn11f?variant=verified&v=5cc13135c221a6b820ea27e9104962db)](https://m8ven.ai/mcp/only-abhiram-check-package-mcp-server-jxn11f?s=readme)

An MCP server that checks whether a package really exists before you install it. It looks up the official registry so an agent can catch made-up package names.

It supports:

- npm
- PyPI
- Maven
- NuGet
- Cargo
- Go

## Tool

`check_package` takes:

| Field | Required | What it is |
| --- | --- | --- |
| `ecosystem` | yes | One of `npm`, `pypi`, `maven`, `nuget`, `cargo`, `go` |
| `name` | yes | Exact package name |
| `version` | no | A specific version to check |

Maven names use `groupId:artifactId`.

The result says whether the package exists, the version that was found, a short description and repository when the registry provides them, and whether deprecation was detected.

## Setup

You need [Node.js](https://nodejs.org/) and a [Cloudflare](https://developers.cloudflare.com/) account if you want to deploy.

```bash
npm install
```

Run it locally:

```bash
npm run dev
```

The worker starts at `http://localhost:8787`. The MCP endpoint is that URL. A health check is at `http://localhost:8787/health`.

Deploy:

```bash
npx wrangler login
npm run deploy
```

## Other commands

```bash
npm test
npm run cf-typegen
```

`cf-typegen` regenerates Worker types after you change bindings in `wrangler.jsonc`.
