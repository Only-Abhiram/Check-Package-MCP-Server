
import type { PackageMetadata } from "../types";

const PYPI_REGISTRY = "https://pypi.org/pypi";

type PyPIReleaseFile = {
  filename?: string;
  yanked?: boolean;
  yanked_reason?: string | null;
};

type PyPIInfo = {
  name?: string;
  version?: string;
  summary?: string;
  project_urls?: Record<string, string> | null;
};

type PyPIPackage = {
  info?: PyPIInfo;
  releases?: Record<string, PyPIReleaseFile[]>;
  urls?: PyPIReleaseFile[];
  vulnerabilities?: unknown[];
};

export async function pypiAdapter(
  name: string,
  requestedVersion?: string,
): Promise<PackageMetadata> {
  const packageName = name.trim();

  if (!packageName) {
    throw new Error("Package name cannot be empty.");
  }

  const encodedName = encodeURIComponent(packageName);

  const url = `${PYPI_REGISTRY}/${encodedName}/json`;

  let response: Response;

  // 1. Fetch project metadata
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "package-reality-check/1.0",
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return {
      ecosystem: "pypi",
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
            "Could not reach the PyPI registry or the request timed out.",
        },
      ],
    };
  }

  // 2. Package not found
  if (response.status === 404) {
    return {
      ecosystem: "pypi",
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
          message: "The project was not found in the PyPI registry.",
        },
      ],
    };
  }

  // 3. Other HTTP errors
  if (!response.ok) {
    return {
      ecosystem: "pypi",
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
          message: `The PyPI registry returned HTTP ${response.status}.`,
        },
      ],
    };
  }

  // 4. Parse JSON
  let data: PyPIPackage;

  try {
    data = (await response.json()) as PyPIPackage;
  } catch {
    return {
      ecosystem: "pypi",
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
          message: "The PyPI registry returned invalid JSON.",
        },
      ],
    };
  }

  // 5. Validate response structure
  if (
    !data.info ||
    typeof data.info.name !== "string" ||
    typeof data.info.version !== "string"
  ) {
    return {
      ecosystem: "pypi",
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
            "The PyPI response did not contain the expected project metadata.",
        },
      ],
    };
  }

  // 6. Package exists
  const packageExists = true;

  // 7. Resolve the requested version
  const releases = data.releases;

  const resolvedVersion = requestedVersion
    ? releases &&
      Object.prototype.hasOwnProperty.call(releases, requestedVersion)
      ? requestedVersion
      : null
    : data.info.version;

  const requestedVersionExists = requestedVersion
    ? resolvedVersion !== null
    : null;

  // 8. Requested version does not exist
  if (requestedVersion && !resolvedVersion) {
    return {
      ecosystem: "pypi",
      name: packageName,
      exists: packageExists,
      requestedVersionExists: false,
      version: null,
      description: data.info.summary ?? null,
      repository:
        data.info.project_urls?.Source ??
        data.info.project_urls?.Repository ??
        null,
      deprecationStatus: "unknown",
      reasons: [
        {
          code: "VERSION_NOT_FOUND",
          message:
            "The project exists, but the requested version was not found.",
        },
      ],
    };
  }

  // 9. Return normalized metadata
  return {
    ecosystem: "pypi",
    name: packageName,
    exists: true,
    requestedVersionExists: requestedVersion
      ? true
      : null,
    version: resolvedVersion,
    description: data.info.summary ?? null,
    repository:
      data.info.project_urls?.Source ??
      data.info.project_urls?.Repository ??
      null,
    deprecationStatus: "unknown",
    reasons: [],
  };
}
