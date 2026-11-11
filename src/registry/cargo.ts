
import type { PackageMetadata } from "../types";

const CARGO_REGISTRY = "https://crates.io/api/v1/crates";

type CargoVersion = {
  id?: number;
  num?: string;
  yanked?: boolean;
  yank_message?: string | null;
};

type CargoCrate = {
  id?: string;
  name?: string;
  description?: string | null;
  repository?: string | null;
  max_version?: string;
  newest_version?: string;
};

type CargoResponse = {
  crate?: CargoCrate;
  versions?: CargoVersion[];
  version?: CargoVersion;
};

export async function cargoAdapter(
  name: string,
  requestedVersion?: string,
): Promise<PackageMetadata> {
  const packageName = name.trim();

  if (!packageName) {
    throw new Error("Crate name cannot be empty.");
  }

  const encodedName = encodeURIComponent(packageName);
  const url = `${CARGO_REGISTRY}/${encodedName}`;

  // 1. Fetch crate metadata
  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "package-reality-check/1.0 (https://github.com/only-abhiram)",
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return {
      ecosystem: "cargo",
      name: packageName,
      exists: null,
      requestedVersionExists: null,
      version: null,
      description: null,
      repository: null,
      deprecationStatus: "unknown",
      reasons: [
        {
          code: "REGISTRY_REQUEST_FAILED",
          message:
            "Could not reach crates.io or the request timed out.",
        },
      ],
    };
  }

  // 2. Crate not found
  if (response.status === 404) {
    return {
      ecosystem: "cargo",
      name: packageName,
      exists: false,
      requestedVersionExists: requestedVersion ? false : null,
      version: null,
      description: null,
      repository: null,
      deprecationStatus: "unknown",
      reasons: [
        {
          code: "PACKAGE_NOT_FOUND",
          message: "The crate was not found in crates.io.",
        },
      ],
    };
  }

  // 3. Other HTTP errors
  if (!response.ok) {
    return {
      ecosystem: "cargo",
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
          message: `crates.io returned HTTP ${response.status}.`,
        },
      ],
    };
  }

  // 4. Parse JSON
  let data: CargoResponse;

  try {
    data = (await response.json()) as CargoResponse;
  } catch {
    return {
      ecosystem: "cargo",
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
          message: "crates.io returned invalid JSON.",
        },
      ],
    };
  }

  // 5. Validate response structure
  if (
    !data.crate ||
    typeof data.crate.id !== "string" ||
    !Array.isArray(data.versions)
  ) {
    return {
      ecosystem: "cargo",
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
            "crates.io response did not contain the expected crate metadata.",
        },
      ],
    };
  }

  const crate = data.crate;
  const versions = data.versions;

  // 6. Resolve requested or latest version
  const resolvedVersion = requestedVersion
    ? versions.find((item) => item.num === requestedVersion) ?? null
    : versions.find((item) => item.num === crate.max_version) ??
      versions.find((item) => item.num === crate.newest_version) ??
      null;

  const requestedVersionExists = requestedVersion
    ? resolvedVersion !== null
    : null;

  // 7. Requested version not found
  if (requestedVersion && !resolvedVersion) {
    return {
      ecosystem: "cargo",
      name: packageName,
      exists: true,
      requestedVersionExists: false,
      version: null,
      description: crate.description ?? null,
      repository: crate.repository ?? null,
      deprecationStatus: "unknown",
      reasons: [
        {
          code: "VERSION_NOT_FOUND",
          message:
            "The crate exists, but the requested version was not found.",
        },
      ],
    };
  }

  // 8. Version metadata unavailable
  if (!resolvedVersion) {
    return {
      ecosystem: "cargo",
      name: packageName,
      exists: true,
      requestedVersionExists: null,
      version: null,
      description: crate.description ?? null,
      repository: crate.repository ?? null,
      deprecationStatus: "unknown",
      reasons: [
        {
          code: "VERSION_METADATA_UNAVAILABLE",
          message:
            "The crate exists, but its version metadata could not be resolved.",
        },
      ],
    };
  }

  // 9. Check whether the release has been yanked
  const yanked = resolvedVersion.yanked === true;

  return {
    ecosystem: "cargo",
    name: packageName,
    exists: true,
    requestedVersionExists: requestedVersion ? true : null,
    version: resolvedVersion.num ?? null,
    description: crate.description ?? null,
    repository: crate.repository ?? null,
    deprecationStatus: "unknown",
    reasons: yanked
      ? [
          {
            code: "RELEASE_YANKED",
            message:
              resolvedVersion.yank_message ??
              "This crate version has been yanked by its maintainer.",
          },
        ]
      : [],
  };
}
