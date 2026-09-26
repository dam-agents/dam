import { loadAll } from "js-yaml";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Parses one YAML document the way js-yaml 4's
 * load did. js-yaml 5's load throws on a source with no document, so here an
 * empty or comment-only file reads as undefined, and a caller treats it like
 * any other missing value. A source with more than one document still throws.
 */
export function loadYamlDocument(source: string): unknown {
  const documents = loadAll(source);
  if (documents.length > 1) {
    throw new Error(
      `expected a single YAML document, found ${documents.length}`,
    );
  }
  return documents[0];
}
