/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { checkPackage } from "./tools/check-package";

type Ecosystem =
  | "npm"
  | "pypi"
  | "maven"
  | "nuget"
  | "cargo"
  | "go";

//helper for GO Packge URL building
function escapeGoModulePath(value: string): string {
  return value.replace(/[A-Z]/g, (char) => `!${char.toLowerCase()}`);
}

//build appropriate Urls for registries
function buildRegistryUrl(
  ecosystem: Ecosystem,
  name: string,
  version?: string,
): string {
  switch (ecosystem) {
    case "npm": {
      const encodedName = name
        .split("/")
        .map(encodeURIComponent)
        .join("/");

      return version
        ? `https://registry.npmjs.org/${encodedName}/${encodeURIComponent(version)}`
        : `https://registry.npmjs.org/${encodedName}`;
    }

    case "pypi": {
      const encodedName = encodeURIComponent(name);

      return version
        ? `https://pypi.org/pypi/${encodedName}/${encodeURIComponent(version)}/json`
        : `https://pypi.org/pypi/${encodedName}/json`;
    }

    case "maven": {
      const parts = name.split(":");

      if (
        parts.length !== 2 ||
        !parts[0].trim() ||
        !parts[1].trim()
      ) {
        throw new Error(
          "Maven package names must use the groupId:artifactId format.",
        );
      }

      const [groupId, artifactId] = parts;

      const params = new URLSearchParams({
        q: version
          ? `g:"${groupId}" AND a:"${artifactId}" AND v:"${version}"`
          : `g:"${groupId}" AND a:"${artifactId}"`,
        core: "gav",
        rows: "1",
        wt: "json",
      });

      if (!version) {
        params.set("sort", "timestamp desc");
      }

      return `https://search.maven.org/solrsearch/select?${params}`;
    }

    case "nuget": {
      const packageId = encodeURIComponent(name.toLowerCase());

      return `https://api.nuget.org/v3-flatcontainer/${packageId}/index.json`;
    }

    case "cargo": {
      const packageName = encodeURIComponent(name);

      return version
        ? `https://crates.io/api/v1/crates/${packageName}/${encodeURIComponent(version)}`
        : `https://crates.io/api/v1/crates/${packageName}`;
    }

    case "go": {
      const modulePath = escapeGoModulePath(name);

      return version
        ? `https://proxy.golang.org/${modulePath}/@v/${escapeGoModulePath(version)}.info`
        : `https://proxy.golang.org/${modulePath}/@latest`;
    }
  }
}

//standard or overall result of any registry response
type RegistryMetadata = {
  exists: boolean;
  version: string | null;
  description: string | null;
  repository: string | null;
  deprecatedStatus: "deprecated" | "not_detected" | "unknown";
};

//parse different registry responses accordingly
function parseRegistryResponse(
  ecosystem: Ecosystem,
  name: string,
  requestedVersion: string | undefined,
  data: any,
): RegistryMetadata {
  switch (ecosystem) {
    case "npm": {
      const resolvedVersion =
        requestedVersion ?? data["dist-tags"]?.latest ?? null;

      const deprecated = requestedVersion
        ? Boolean(data.deprecated)
        : Boolean(
          data.versions?.[resolvedVersion ?? ""]?.deprecated,
        );

      return {
        exists: true,
        version: resolvedVersion,
        description: data.description ?? null,
        repository: data.repository?.url ?? null,
        deprecatedStatus: deprecated
          ? "deprecated"
          : "not_detected",
      };
    }

    case "pypi": {
      return {
        exists: true,
        version: data.info?.version ?? requestedVersion ?? null,
        description: data.info?.summary ?? null,
        repository:
          data.info?.project_urls?.Source ??
          data.info?.project_urls?.Repository ??
          null,
        deprecatedStatus: "unknown",
      };
    }

    case "maven": {
      const doc = data.response?.docs?.[0];

      if (!doc) {
        return {
          exists: false,
          version: null,
          description: null,
          repository: null,
          deprecatedStatus: "unknown",
        };
      }

      return {
        exists: true,
        version: doc.v ?? null,
        description: null,
        repository: null,
        deprecatedStatus: "unknown",
      };
    }

    case "nuget": {
      const versions: string[] = data.versions ?? [];

      const resolvedVersion = requestedVersion
        ? versions.find(
          (item) =>
            item.toLowerCase() === requestedVersion.toLowerCase(),
        ) ?? null
        : versions.at(-1) ?? null;

      return {
        exists: versions.length > 0,
        version: resolvedVersion,
        description: null,
        repository: null,
        deprecatedStatus: "unknown",
      };
    }

    case "cargo": {
      const crate = data.crate;
      const crateVersion = data.version;

      const resolvedVersion =
        crateVersion?.num ??
        crate?.max_version ??
        crate?.newest_version ??
        null;

      return {
        exists: Boolean(crate),
        version: resolvedVersion,
        description: crate?.description ?? null,
        repository: crate?.repository ?? null,
        deprecatedStatus: "unknown",
      };
    }

    case "go": {
      return {
        exists: Boolean(data.Version),
        version: data.Version ?? null,
        description: null,
        repository: null,
        deprecatedStatus: "unknown",
      };
    }
  }
}



function createServer() {
  //create the server
  const server = new McpServer({
    name: "package-reality-check",
    version: "1.0.0",
  });

  //register the tools 
  server.registerTool(
    "check_package",
    {
      description:
        "Check whether a package exists in the official npm, PyPI, Maven, NuGet, Cargo, or Go registry. " +
        "Use this tool before installing a dependency to help detect hallucinated package names.",
      inputSchema: z.object({
        ecosystem: z
          .enum([
            "npm",
            "pypi",
            "maven",
            "nuget",
            "cargo",
            "go"
          ])
          .describe("Package ecosystem to check"),
        name: z
          .string()
          .min(1)
          .max(214)
          .describe("Exact package name to verify"),
        version: z
          .string()
          .optional()
          .describe("Optional version to check"),
      }),
    },
    async ({ ecosystem, name, version }) => {
      return checkPackage({ ecosystem, name, version });
    },
  );

  //return the server
  return server;
}

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        service: "package-reality-check",
      });
    }

    return createMcpHandler(createServer)(request, env, ctx);
  },
} satisfies ExportedHandler;