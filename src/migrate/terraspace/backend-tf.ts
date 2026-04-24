/**
 * Extracts Terraspace expansion templates from a `backend.tf` file's text.
 *
 * Terraspace renders backend config via ERB:
 *
 *     bucket = "<%= expansion('terraform-state-:ACCOUNT-:REGION-:ENV') %>"
 *
 * This module pulls those template strings back out so Subspace can
 * derive the legacy state key/bucket without executing Ruby.
 */

export interface ExtractedTemplates {
	bucket: string | null;
	key: string | null;
	region: string | null;
}

export function extractTemplates(backendTf: string): ExtractedTemplates {
	return {
		bucket: matchField(backendTf, "bucket"),
		key: matchField(backendTf, "key"),
		region: matchField(backendTf, "region"),
	};
}

function matchField(content: string, field: string): string | null {
	const pattern = new RegExp(
		`${field}\\s*=\\s*"<%=\\s*expansion\\(\\s*['"]([^'"]+)['"]\\s*\\)\\s*%>"`,
	);
	return content.match(pattern)?.[1] ?? null;
}
