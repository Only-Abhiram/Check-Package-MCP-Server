
import type { PackageMetadata } from "../types";

const NUGET_REGISTRY = "https://api.nuget.org/v3-flatcontainer";

type NuGetIndex = {
  versions?: string[];
};

function createMetadata(
  name: string,
  overrides: Partial<PackageMetadata> = {},
): PackageMetadata {
  return {
    ecosystem: "nuget",
    name,
    exists: null,
    requestedVersionExists: null,
    version: null,
    description: null,
    repository: null,
    deprecationStatus: "unknown",
    reasons: [],
    ...overrides,
  };
}

export async function nugetAdapter(
  name: string,
  requestedVersion?: string,
): Promise<PackageMetadata> {
  const packageName = name.trim();

  if (!packageName) {
    throw new Error("Package name cannot be empty.");
  }

  // NuGet package IDs are case-insensitive.
  const normalizedName = packageName.toLowerCase();

  const url = `${NUGET_REGISTRY}/${encodeURIComponent(
    normalizedName,
  )}/index.json`;

  // 1. Fetch package version index
  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "package-reality-check/1.0",
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return createMetadata(packageName, {
      reasons: [
        {
          code: "REGISTRY_REQUEST_FAILED",
          message:
            "Could not reach the NuGet registry or the request timed out.",
        },
      ],
    });
  }

  // 2. Package not found
  if (response.status === 404) {
    return createMetadata(packageName, {
      exists: false,
      requestedVersionExists: requestedVersion ? false : null,
      reasons: [
        {
          code: "PACKAGE_NOT_FOUND",
          message: "The package was not found in the NuGet registry.",
        },
      ],
    });
  }

  // 3. Other HTTP errors
  if (!response.ok) {
    return createMetadata(packageName, {
      reasons: [
        {
          code: "REGISTRY_ERROR",
          message: `The NuGet registry returned HTTP ${response.status}.`,
        },
      ],
    });
  }

  // 4. Parse JSON
  let data: NuGetIndex;

  try {
    data = (await response.json()) as NuGetIndex;
  } catch {
    return createMetadata(packageName, {
      reasons: [
        {
          code: "INVALID_REGISTRY_RESPONSE",
          message: "The NuGet registry returned invalid JSON.",
        },
      ],
    });
  }

  // 5. Validate response structure
  if (
    !Array.isArray(data.versions) ||
    data.versions.some((version) => typeof version !== "string")
  ) {
    return createMetadata(packageName, {
      reasons: [
        {
          code: "INVALID_REGISTRY_RESPONSE",
          message:
            "The NuGet registry response did not contain a valid versions array.",
        },
      ],
    });
  }

  const versions = data.versions;

  if (versions.length === 0) {
    return createMetadata(packageName, {
      exists: false,
      reasons: [
        {
          code: "PACKAGE_NOT_FOUND",
          message: "The package has no available versions.",
        },
      ],
    });
  }

  // 6. Resolve requested version or latest version
  const resolvedVersion = requestedVersion
    ? versions.find(
        (version) =>
          version.toLowerCase() === requestedVersion.toLowerCase(),
      ) ?? null
    : versions[versions.length - 1];

  const requestedVersionExists = requestedVersion
    ? resolvedVersion !== null
    : null;

  // 7. Requested version not found
  if (requestedVersion && !resolvedVersion) {
    return createMetadata(packageName, {
      exists: true,
      requestedVersionExists: false,
      version: null,
      reasons: [
        {
          code: "VERSION_NOT_FOUND",
          message:
            "The package exists, but the requested version was not found.",
        },
      ],
    });
  }

  // 8. Successful lookup
  return createMetadata(packageName, {
    exists: true,
    requestedVersionExists,
    version: resolvedVersion,
  });
}
