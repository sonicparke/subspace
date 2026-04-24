import type { BackendType } from "./backends.js";

export type ProviderType = "aws" | "azure" | "gcp" | "cloudflare";

/**
 * Literal token embedded in an authoritative `config/terraform/providers.tf`
 * when it is scaffolded without a concrete region. The build pipeline rewrites
 * this per-region before copying the file into the stack build dir.
 */
export const REGION_PLACEHOLDER = "__SUBSPACE_REGION__";

export interface ProviderSettings {
	region?: string;
	project?: string;
}

export function recommendedBackendForProvider(
	provider: ProviderType,
): BackendType {
	switch (provider) {
		case "aws":
			return "s3";
		case "gcp":
			return "gcs";
		case "azure":
			return "azurerm";
		case "cloudflare":
			return "s3";
	}
}

export function recommendedProviderForBackend(
	backend: BackendType,
): ProviderType {
	switch (backend) {
		case "s3":
			return "aws";
		case "gcs":
			return "gcp";
		case "azurerm":
			return "azure";
		case "local":
			return "aws";
	}
}

export function defaultProviderSettings(
	provider: ProviderType,
	overrides: Partial<ProviderSettings> = {},
): ProviderSettings {
	const defaults: ProviderSettings =
		provider === "aws"
			? { region: "us-east-1" }
			: provider === "gcp"
				? { region: "us-central1", project: "replace-me-project-id" }
				: {};
	return { ...defaults, ...overrides };
}

export function renderProviderTf(
	provider: ProviderType,
	settings: ProviderSettings,
): string {
	switch (provider) {
		case "aws":
			return `terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "${settings.region ?? REGION_PLACEHOLDER}"
}
`;
		case "gcp":
			return `terraform {
  required_version = ">= 1.6.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = "${settings.project ?? "replace-me-project-id"}"
  region  = "${settings.region ?? REGION_PLACEHOLDER}"
}
`;
		case "azure":
			return `terraform {
  required_version = ">= 1.6.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {}
}
`;
		case "cloudflare":
			return `terraform {
  required_version = ">= 1.6.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "cloudflare" {}
`;
	}
}
