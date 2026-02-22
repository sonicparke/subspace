type SectionMap = Record<string, Record<string, string | string[]>>;

export function parseTomlLite(content: string): SectionMap {
	const result: SectionMap = {};
	let currentSection = "";

	for (const rawLine of content.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;

		const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
		if (sectionMatch) {
			currentSection = sectionMatch[1];
			result[currentSection] ??= {};
			continue;
		}

		const kvMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
		if (!kvMatch || !currentSection) continue;
		const key = kvMatch[1];
		const rawValue = kvMatch[2].trim();
		if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
			const inner = rawValue.slice(1, -1).trim();
			const values = inner
				? inner.split(",").map((v) => unquote(v.trim())).filter(Boolean)
				: [];
			result[currentSection][key] = values;
			continue;
		}
		result[currentSection][key] = unquote(rawValue);
	}

	return result;
}

export function stringifyTomlLite(sections: SectionMap): string {
	const output: string[] = [];
	for (const [section, kv] of Object.entries(sections)) {
		output.push(`[${section}]`);
		for (const [key, value] of Object.entries(kv)) {
			if (Array.isArray(value)) {
				const rendered = value.map((v) => `"${escape(v)}"`).join(", ");
				output.push(`${key} = [${rendered}]`);
			} else {
				output.push(`${key} = "${escape(value)}"`);
			}
		}
		output.push("");
	}
	return output.join("\n").trimEnd() + "\n";
}

function unquote(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

function escape(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
