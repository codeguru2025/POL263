import { apiJson } from "./client";

export interface Product {
  id: string;
  name: string;
  code: string;
  description: string | null;
}

export interface ProductVersion {
  id: string;
  productId: string;
  version: number;
  premiumMonthlyUsd: string | null;
  premiumMonthlyZar: string | null;
  premiumWeeklyUsd: string | null;
  premiumWeeklyZar: string | null;
  premiumBiweeklyUsd: string | null;
  premiumBiweeklyZar: string | null;
  eligibilityMinAge: number | null;
  eligibilityMaxAge: number | null;
}

export interface AddOn {
  id: string;
  name: string;
  description: string | null;
  pricingMode: string;
  priceAmount: string | null;
  priceMonthly: string | null;
  priceWeekly: string | null;
  priceBiweekly: string | null;
  isActive: boolean;
}

export async function getProducts(): Promise<Product[]> {
  return apiJson("/api/products");
}

/** All versions across all products — filter client-side by productId, matching
 *  the single-fetch pattern the endpoint itself is designed for. */
export async function getProductVersions(): Promise<ProductVersion[]> {
  return apiJson("/api/product-versions");
}

export async function getAddOns(): Promise<AddOn[]> {
  return apiJson("/api/add-ons");
}
