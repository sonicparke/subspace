export type BackendType = "local" | "s3" | "gcs" | "azurerm";

export interface BackendSettings {
	region?: string;
	bucket?: string;
	resource_group_name?: string;
	storage_account_name?: string;
	container_name?: string;
}

const DEFAULT_REGION: Record<BackendType, string | undefined> = {
	local: undefined,
	s3: "us-east-1",
	gcs: "us-central1",
	azurerm: undefined,
};

export function defaultBackendSettings(
	backend: BackendType,
	overrides: Partial<BackendSettings> = {},
): BackendSettings {
	return {
		...overrides,
		region: overrides.region ?? DEFAULT_REGION[backend],
	};
}

export function renderBackendTf(
	backend: BackendType,
	settings: BackendSettings,
): string {
	switch (backend) {
		case "local":
			return `terraform {
  backend "local" {}
}
`;
		case "s3":
			return `terraform {
  backend "s3" {
    bucket = "${settings.bucket ?? "replace-me-tfstate"}"
    region = "${settings.region ?? "us-east-1"}"
  }
}
`;
		case "gcs":
			return `terraform {
  backend "gcs" {
    bucket = "${settings.bucket ?? "replace-me-tfstate"}"
  }
}
`;
		case "azurerm":
			return `terraform {
  backend "azurerm" {
    resource_group_name  = "${settings.resource_group_name ?? "replace-me-rg"}"
    storage_account_name = "${settings.storage_account_name ?? "replacemetfstate"}"
    container_name       = "${settings.container_name ?? "tfstate"}"
  }
}
`;
	}
}

export function validateBackendSettings(
	backend: BackendType,
	settings: BackendSettings,
): string[] {
	switch (backend) {
		case "local":
			return [];
		case "s3":
			return settings.region ? [] : ["s3 backend requires region"];
		case "gcs":
			return [];
		case "azurerm":
			return [];
	}
}
