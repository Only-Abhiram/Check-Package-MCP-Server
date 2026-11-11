import type { Ecosystem } from "../types";
import { npmAdapter } from "../registry/npm";
import { pypiAdapter } from "../registry/pypi";
import { mavenAdapter } from "../registry/maven";
import { cargoAdapter } from "../registry/cargo";
import { goAdapter } from "../registry/go";
import { nugetAdapter } from "../registry/nuget";

export async function checkPackage({
    ecosystem,
    name,
    version,
}: {
    ecosystem: Ecosystem;
    name: string;
    version?: string;
}) {
    const packageName = name.trim();

    if (!packageName) {
        return {
            isError: true,
            content: [
                {
                    type: "text" as const,
                    text: "Package name cannot be empty.",
                },
            ],
        };
    }

    try {
        let result;

        switch (ecosystem) {
            case "npm":
                result = await npmAdapter(packageName, version);
                break;

            case "pypi":
                result = await pypiAdapter(packageName, version);
                break;

            case "maven":
                result = await mavenAdapter(packageName, version);
                break;

            case "nuget":
                result = await nugetAdapter(packageName, version);
                break;

            case "cargo":
                result = await cargoAdapter(packageName, version);
                break;

            case "go":
                result = await goAdapter(packageName, version);
                break;
        }

        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify(result),
                },
            ],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                {
                    type: "text" as const,
                    text:
                        error instanceof Error
                            ? error.message
                            : "An unexpected error occurred.",
                },
            ],
        };
    }
}