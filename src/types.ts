export type Ecosystem =
  | "npm"
  | "pypi"
  | "maven"
  | "nuget"
  | "cargo"
  | "go";

export type PackageMetadata = {
  ecosystem: Ecosystem;
  name: string;

  exists: boolean | null;
  requestedVersionExists: boolean | null;

  version: string | null;
  description: string | null;
  repository: string | null;

  deprecationStatus:
    | "deprecated"
    | "not_detected"
    | "unknown";

  reasons: {
    code: string;
    message: string;
  }[];
};