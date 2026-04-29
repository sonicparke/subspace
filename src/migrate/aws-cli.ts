export interface AwsCliOptions {
	profile?: string;
}

export function awsProfileArgs(options?: AwsCliOptions): string[] {
	const profile = options?.profile?.trim();
	return profile ? ["--profile", profile] : [];
}
