import { describe, expect, it } from "vitest";
import { findReferencedModules } from "../../src/build/module-discovery.js";

describe("findReferencedModules", () => {
	it("returns empty list when no sources provided", () => {
		expect(findReferencedModules([])).toEqual([]);
	});

	it("returns empty list when no module references present", () => {
		expect(
			findReferencedModules([
				'resource "aws_s3_bucket" "b" { bucket = "x" }',
			]),
		).toEqual([]);
	});

	it("extracts a single module referenced via ../../modules/<name>", () => {
		const tf = `
module "key_pair" {
  source = "../../modules/key_pair"
}
`;
		expect(findReferencedModules([tf])).toEqual(["key_pair"]);
	});

	it("extracts multiple modules from one file", () => {
		const tf = `
module "vpc" { source = "../../modules/vpc" }
module "key_pair" { source = "../../modules/key_pair" }
`;
		expect(findReferencedModules([tf])).toEqual(["key_pair", "vpc"]);
	});

	it("de-duplicates modules referenced from multiple files", () => {
		expect(
			findReferencedModules([
				'module "vpc" { source = "../../modules/vpc" }',
				'module "vpc2" { source = "../../modules/vpc" }',
			]),
		).toEqual(["vpc"]);
	});

	it("matches ./modules/<name> (single-dot relative)", () => {
		expect(
			findReferencedModules(['source = "./modules/foo"']),
		).toEqual(["foo"]);
	});

	it("matches deep relative prefixes like ../../../modules/<name> (nested .tf in stack)", () => {
		expect(
			findReferencedModules(['source = "../../../modules/deep"']),
		).toEqual(["deep"]);
	});

	it("matches when source= has arbitrary whitespace", () => {
		expect(
			findReferencedModules(['  source   =   "../../modules/ws"  ']),
		).toEqual(["ws"]);
	});

	it("ignores subpaths after the module name", () => {
		expect(
			findReferencedModules(['source = "../../modules/foo/nested"']),
		).toEqual(["foo"]);
	});

	it("ignores commented-out # source lines", () => {
		const tf = `
# source = "../../modules/commented"
module "real" { source = "../../modules/real" }
`;
		expect(findReferencedModules([tf])).toEqual(["real"]);
	});

	it("ignores commented-out // source lines", () => {
		const tf = `
  // source = "../../modules/commented"
module "real" { source = "../../modules/real" }
`;
		expect(findReferencedModules([tf])).toEqual(["real"]);
	});

	it("does not match bare modules/<name> without ./ or ../ prefix", () => {
		expect(
			findReferencedModules(['source = "modules/foo"']),
		).toEqual([]);
	});

	it("does not match remote sources", () => {
		expect(
			findReferencedModules([
				'source = "git::https://github.com/x/modules/foo"',
				'source = "registry.terraform.io/modules/foo"',
			]),
		).toEqual([]);
	});

	it("does not match absolute paths", () => {
		expect(
			findReferencedModules(['source = "/abs/modules/foo"']),
		).toEqual([]);
	});

	it("does not match sibling-relative paths that are not modules/", () => {
		expect(
			findReferencedModules(['source = "../../other/foo"']),
		).toEqual([]);
	});

	it("returns names sorted alphabetically", () => {
		expect(
			findReferencedModules([
				'source = "../../modules/zebra"',
				'source = "../../modules/alpha"',
				'source = "../../modules/mango"',
			]),
		).toEqual(["alpha", "mango", "zebra"]);
	});

	it("matches single-quoted source strings (HCL allows both quote styles)", () => {
		expect(
			findReferencedModules([
				"module \"a\" { source = '../../modules/singleQ' }",
			]),
		).toEqual(["singleQ"]);
	});
});
