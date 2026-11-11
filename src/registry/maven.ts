
import type { PackageMetadata } from "../types";

const MAVEN_REGISTRY =
  "https://search.maven.org/solrsearch/select";

type MavenDocument = {
  id?: string;
  g?: string;
  a?: string;
  v?: string;
  latestVersion?: string;
  timestamp?: number;
  versionCount?: number;
};

type MavenResponse = {
  response?: {
    numFound?: number;
    docs?: MavenDocument[];
  };
};

export async function mavenAdapter(
  name: string,
  requestedVersion?: string,
): Promise<PackageMetadata> {
  const packageName = name.trim();

  if (!packageName) {
    throw new Error("Maven coordinates cannot be empty.");
  }

  // Maven package names must be groupId:artifactId
  const parts = packageName.split(":");

  if (
    parts.length !== 2 ||
    !parts[0].trim() ||
    !parts[1].trim()
  ) {
    throw new Error(
      "Maven package names must use groupId:artifactId format.",
    );
  }

  const [groupId, artifactId] = parts;

  // Construct the exact artifact query
  const params = new URLSearchParams({
    q: `g:"${groupId}" AND a:"${artifactId}"`,
    core: "gav",
    rows: "1",
    wt: "json",
  });

  if (requestedVersion) {
    params.set(
      "q",
      `g:"${groupId}" AND a:"${artifactId}" AND v:"${requestedVersion}"`,
    );
  }

  const url = `${MAVEN_REGISTRY}?${params.toString()}`;

  let response: Response;

  // 1. Fetch Maven Central
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
      ecosystem: "maven",
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
            "Could not reach Maven Central or the request timed out.",
        },
      ],
    };
  }

  // 2. Handle HTTP errors
  if (!response.ok) {
    return {
      ecosystem: "maven",
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
          message: `Maven Central returned HTTP ${response.status}.`,
        },
      ],
    };
  }

  // 3. Parse JSON
  let data: MavenResponse;

  try {
    data = (await response.json()) as MavenResponse;
  } catch {
    return {
      ecosystem: "maven",
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
          message: "Maven Central returned invalid JSON.",
        },
      ],
    };
  }

  // 4. Validate the response structure
  if (
    typeof data.response?.numFound !== "number" ||
    !Array.isArray(data.response.docs)
  ) {
    return {
      ecosystem: "maven",
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
            "Maven Central response did not contain the expected search results.",
        },
      ],
    };
  }

  const docs = data.response.docs;
  const numFound = data.response.numFound;

  // 5. Artifact does not exist
  if (numFound === 0 && requestedVersion) {
    // A version-specific query returned nothing.
    // Check the artifact without specifying a version.
    return await checkArtifactWithoutVersion(
      groupId,
      artifactId,
      packageName,
    );
  }

  if (numFound === 0) {
    return {
      ecosystem: "maven",
      name: packageName,
      exists: false,
      requestedVersionExists: null,
      version: null,
      description: null,
      repository: null,
      deprecationStatus: "unknown",
      reasons: [
        {
          code: "PACKAGE_NOT_FOUND",
          message:
            "The artifact was not found in Maven Central.",
        },
      ],
    };
  }

  const doc = docs[0];

  // 6. Requested version exists
  if (requestedVersion) {
    if (!doc || doc.v !== requestedVersion) {
      return {
        ecosystem: "maven",
        name: packageName,
        exists: null,
        requestedVersionExists: null,
        version: null,
        description: null,
        repository: null,
        deprecationStatus: "unknown",
        reasons: [
          {
            code: "LOOKUP_INCONCLUSIVE",
            message:
              "Maven Central returned results that did not match the requested coordinates.",
          },
        ],
      };
    }

    return {
      ecosystem: "maven",
      name: packageName,
      exists: true,
      requestedVersionExists: true,
      version: doc.v ?? requestedVersion,
      description: null,
      repository: null,
      deprecationStatus: "unknown",
      reasons: [],
    };
  }

  // 7. Package exists; return latest version
  if (!doc || typeof doc.v !== "string") {
    return {
      ecosystem: "maven",
      name: packageName,
      exists: true,
      requestedVersionExists: null,
      version: null,
      description: null,
      repository: null,
      deprecationStatus: "unknown",
      reasons: [
        {
          code: "VERSION_METADATA_UNAVAILABLE",
          message:
            "The artifact exists, but its latest version could not be resolved.",
        },
      ],
    };
  }

  return {
    ecosystem: "maven",
    name: packageName,
    exists: true,
    requestedVersionExists: null,
    version: doc.v,
    description: null,
    repository: null,
    deprecationStatus: "unknown",
    reasons: [],
  };
}

// Fallback: check artifact existence independently
async function checkArtifactWithoutVersion(
  groupId: string,
  artifactId: string,
  packageName: string,
): Promise<PackageMetadata> {
  const params = new URLSearchParams({
    q: `g:"${groupId}" AND a:"${artifactId}"`,
    rows: "1",
    wt: "json",
  });

  const url = `${MAVEN_REGISTRY}?${params.toString()}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "package-reality-check/1.0",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return {
        ecosystem: "maven",
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
            message:
              `Maven Central returned HTTP ${response.status} during artifact verification.`,
          },
        ],
      };
    }

    const data = (await response.json()) as MavenResponse;

    if (
      typeof data.response?.numFound !== "number" ||
      !Array.isArray(data.response.docs)
    ) {
      return {
        ecosystem: "maven",
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
              "Maven Central returned invalid artifact verification data.",
          },
        ],
      };
    }

    if (data.response.numFound === 0) {
      return {
        ecosystem: "maven",
        name: packageName,
        exists: false,
        requestedVersionExists: false,
        version: null,
        description: null,
        repository: null,
        deprecationStatus: "unknown",
        reasons: [
          {
            code: "PACKAGE_NOT_FOUND",
            message:
              "The artifact was not found in Maven Central.",
          },
        ],
      };
    }

    return {
      ecosystem: "maven",
      name: packageName,
      exists: true,
      requestedVersionExists: false,
      version: null,
      description: null,
      repository: null,
      deprecationStatus: "unknown",
      reasons: [
        {
          code: "VERSION_NOT_FOUND",
          message:
            "The artifact exists, but the requested version was not found.",
        },
      ],
    };
  } catch {
    return {
      ecosystem: "maven",
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
            "Could not verify artifact existence in Maven Central.",
        },
      ],
    };
  }
}
