
import type { PackageMetadata } from "../types";

const GO_REGISTRY = "https://proxy.golang.org";

type GoModuleInfo = {
  Version?: string;
  Time?: string;
  Origin?: {
    VCS?: string;
    URL?: string;
    Ref?: string;
    Hash?: string;
  };
};

// Go module paths encode uppercase characters as ! + lowercase.
function escapeGoModulePath(value: string): string {
  return value.replace(/[A-Z]/g, (char) => `!${char.toLowerCase()}`);
}

function createMetadata(
  name: string,
  overrides: Partial<PackageMetadata> = {},
): PackageMetadata {
  return {
    ecosystem: "go",
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

export async function goAdapter(
  name: string,
  requestedVersion?: string,
): Promise<PackageMetadata> {
  const modulePath = name.trim();

  if (!modulePath) {
    throw new Error("Go module path cannot be empty.");
  }

  const encodedModulePath = escapeGoModulePath(modulePath);

  const encodedVersion = requestedVersion
    ? escapeGoModulePath(requestedVersion)
    : undefined;

  const url = requestedVersion
    ? `${GO_REGISTRY}/${encodedModulePath}/@v/${encodedVersion}.info`
    : `${GO_REGISTRY}/${encodedModulePath}/@latest`;

  // 1. Fetch module information
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
    return createMetadata(modulePath, {
      reasons: [
        {
          code: "REGISTRY_REQUEST_FAILED",
          message:
            "Could not reach the Go module proxy or the request timed out.",
        },
      ],
    });
  }

  // 2. Handle module/version not found
  if (response.status === 404 || response.status === 410) {
    if (!requestedVersion) {
      return createMetadata(modulePath, {
        exists: false,
        reasons: [
          {
            code: "PACKAGE_NOT_FOUND",
            message: "The module was not found in the Go module proxy.",
          },
        ],
      });
    }

    // Verify module existence independently using @latest.
    try {
      const latestResponse = await fetch(
        `${GO_REGISTRY}/${encodedModulePath}/@latest`,
        {
          headers: {
            Accept: "application/json",
            "User-Agent": "package-reality-check/1.0",
          },
          signal: AbortSignal.timeout(5000),
        },
      );

      if (latestResponse.status === 404 || latestResponse.status === 410) {
        return createMetadata(modulePath, {
          exists: false,
          requestedVersionExists: false,
          reasons: [
            {
              code: "PACKAGE_NOT_FOUND",
              message: "The module was not found in the Go module proxy.",
            },
          ],
        });
      }

      if (!latestResponse.ok) {
        return createMetadata(modulePath, {
          requestedVersionExists: false,
          reasons: [
            {
              code: "REGISTRY_ERROR",
              message: `The Go module proxy returned HTTP ${latestResponse.status}.`,
            },
          ],
        });
      }

      const latestData =
        (await latestResponse.json()) as GoModuleInfo;

      if (typeof latestData.Version !== "string" || !latestData.Version) {
        return createMetadata(modulePath, {
          requestedVersionExists: false,
          reasons: [
            {
              code: "INVALID_REGISTRY_RESPONSE",
              message:
                "The Go module proxy response did not contain a valid version.",
            },
          ],
        });
      }

      return createMetadata(modulePath, {
        exists: true,
        requestedVersionExists: false,
        version: latestData.Version,
        repository: latestData.Origin?.URL ?? null,
        reasons: [
          {
            code: "VERSION_NOT_FOUND",
            message: `Module exists, but version ${requestedVersion} was not found.`,
          },
        ],
      });
    } catch {
      return createMetadata(modulePath, {
        requestedVersionExists: false,
        reasons: [
          {
            code: "REGISTRY_REQUEST_FAILED",
            message: "Could not verify module existence.",
          },
        ],
      });
    }
  }

  // 3. Handle other HTTP errors
  if (!response.ok) {
    return createMetadata(modulePath, {
      reasons: [
        {
          code: "REGISTRY_ERROR",
          message: `The Go module proxy returned HTTP ${response.status}.`,
        },
      ],
    });
  }

  // 4. Parse JSON
  let data: GoModuleInfo;

  try {
    data = (await response.json()) as GoModuleInfo;
  } catch {
    return createMetadata(modulePath, {
      reasons: [
        {
          code: "INVALID_REGISTRY_RESPONSE",
          message: "The Go module proxy returned invalid JSON.",
        },
      ],
    });
  }

  // 5. Validate response structure
  if (typeof data.Version !== "string" || !data.Version) {
    return createMetadata(modulePath, {
      reasons: [
        {
          code: "INVALID_REGISTRY_RESPONSE",
          message:
            "The Go module proxy response did not contain a valid version.",
        },
      ],
    });
  }

  // 6. Successful lookup
  return createMetadata(modulePath, {
    exists: true,
    requestedVersionExists: requestedVersion ? true : null,
    version: data.Version,
    repository: data.Origin?.URL ?? null,
  });
}
