import type { PackageMetadata } from "../types";

const NPM_REGISTRY = "https://registry.npmjs.org";

type NpmVersion = {
  name?: string;
  version?: string;
  description?: string;
  deprecated?: string;
  repository?: {
    url?: string;
  };
};

type NpmPackage = {
  name?: string;
  description?: string;
  repository?: {
    url?: string;
  };
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, NpmVersion>;
};

export async function npmAdapter(
  name: string,
  requestedVersion?: string,
): Promise<PackageMetadata> {
  const packageName = name.trim();

  if (!packageName) {
    throw new Error("Package name cannot be empty.");
  }

  const encodedName = packageName
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  const url = `${NPM_REGISTRY}/${encodedName}`;

  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return {
      ecosystem: "npm",
      name: packageName,
      exists: null,
      requestedVersionExists: requestedVersion
        ? null
        : null,
      version: null,
      description: null,
      repository: null,
      deprecationStatus: "unknown",
      reasons: [
        {
          code: "REGISTRY_REQUEST_FAILED",
          message:
            "Could not reach the npm registry or the request timed out.",
        },
      ],
    };
  }

  //package name not found
  if (response.status === 404) {
    return {
      ecosystem: "npm",
      name: packageName,
      exists: false,
      requestedVersionExists: requestedVersion
        ? false
        : null,
      version: null,
      description: null,
      repository: null,
      deprecationStatus: "unknown",
      reasons: [
        {
          code: "PACKAGE_NOT_FOUND",
          message: "The package was not found in the npm registry.",
        },
      ],
    };
  }

  if (!response.ok) {
    return {
      ecosystem: "npm",
      name: packageName,
      exists: null,
      requestedVersionExists: null,
      version: null,
      description: null,
      repository: null,
      deprecationStatus: "unknown",
      reasons: [
        {
          code: "REGISTRY_ERROR",
          message: `The npm registry returned HTTP ${response.status}.`,
        },
      ],
    };
  }

  let data: NpmPackage;

  try {
    data = (await response.json()) as NpmPackage;
  } catch {
    return {
      ecosystem: "npm",
      name: packageName,
      exists: null,
      requestedVersionExists: null,
      version: null,
      description: null,
      repository: null,
      deprecationStatus: "unknown",
      reasons: [
        {
          code: "INVALID_REGISTRY_RESPONSE",
          message: "The npm registry returned invalid JSON.",
        },
      ],
    };
  }

  // Validate the minimum response structure before trusting it.
  if (
    typeof data.name !== "string" ||
    !data.versions ||
    typeof data.versions !== "object" ||
    Array.isArray(data.versions)
  ) {
    return {
      ecosystem: "npm",
      name: packageName,
      exists: null,
      requestedVersionExists: null,
      version: null,
      description: null,
      repository: null,
      deprecationStatus: "unknown",
      reasons: [
        {
          code: "INVALID_REGISTRY_RESPONSE",
          message:
            "The npm registry response did not contain the expected package metadata.",
        },
      ],
    };
  }

  const packageExists = true;

  const latestVersion =
    data["dist-tags"]?.latest ?? null;

  const resolvedVersion = requestedVersion
    ? Object.keys(data.versions).find(
        (publishedVersion) =>
          publishedVersion === requestedVersion,
      ) ?? null
    : latestVersion;

  const requestedVersionExists = requestedVersion
    ? resolvedVersion !== null
    : null;

  // If a requested version wasn't found, do not substitute latest.
  if (requestedVersion && !resolvedVersion) {
    return {
      ecosystem: "npm",
      name: packageName,
      exists: packageExists,
      requestedVersionExists: false,
      version: null,
      description: data.description ?? null,
      repository: data.repository?.url ?? null,
      deprecationStatus: "unknown",
      reasons: [
        {
          code: "VERSION_NOT_FOUND",
          message:
            "The package exists, but the requested version was not found.",
        },
      ],
    };
  }

  const versionMetadata = resolvedVersion
    ? data.versions[resolvedVersion]
    : undefined;

  if (!versionMetadata) {
    return {
      ecosystem: "npm",
      name: packageName,
      exists: packageExists,
      requestedVersionExists: null,
      version: null,
      description: data.description ?? null,
      repository: data.repository?.url ?? null,
      deprecationStatus: "unknown",
      reasons: [
        {
          code: "VERSION_METADATA_UNAVAILABLE",
          message:
            "The package exists, but its resolved version metadata is unavailable.",
        },
      ],
    };
  }

  const deprecated =
    typeof versionMetadata.deprecated === "string" &&
    versionMetadata.deprecated.trim().length > 0;

  return {
    ecosystem: "npm",
    name: packageName,
    exists: true,
    requestedVersionExists: requestedVersion
      ? true
      : null,
    version: resolvedVersion,
    description:
      versionMetadata.description ??
      data.description ??
      null,
    repository:
      versionMetadata.repository?.url ??
      data.repository?.url ??
      null,
    deprecationStatus: deprecated
      ? "deprecated"
      : "not_detected",
    reasons: deprecated
      ? [
          {
            code: "PACKAGE_DEPRECATED",
            message: versionMetadata.deprecated!,
          },
        ]
      : [],
  };
}