export interface FanoutOptions<T> {
	items: T[];
	parallel: number;
	failFast?: boolean;
	runItem: (item: T) => Promise<number>;
}

export interface FanoutResult<T> {
	item: T;
	exitCode: number;
}

export async function runAcrossRegions<T>(
	options: FanoutOptions<T>,
): Promise<FanoutResult<T>[]> {
	const parallel = Math.max(1, options.parallel);
	const queue = [...options.items];
	const results: FanoutResult<T>[] = [];
	let stop = false;

	const workers = Array.from({ length: Math.min(parallel, queue.length) }, async () => {
		while (queue.length > 0) {
			if (stop && options.failFast) return;
			const item = queue.shift();
			if (!item) return;
			const exitCode = await options.runItem(item);
			results.push({ item, exitCode });
			if (exitCode !== 0 && options.failFast) {
				stop = true;
			}
		}
	});

	await Promise.all(workers);
	return results;
}
