declare const BUILD_VERSION: string | undefined;

export const version =
	typeof BUILD_VERSION !== "undefined" ? BUILD_VERSION : "0.0.0-dev";
