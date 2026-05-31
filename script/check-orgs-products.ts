import "dotenv/config";
import { db } from "../server/db";
import { organizations, products, productVersions, clients } from "@shared/schema";
import { eq } from "drizzle-orm";

const orgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations);
for (const o of orgs) {
  const prods = await db.select({ id: products.id, name: products.name }).from(products).where(eq(products.organizationId, o.id));
  let versCount = 0;
  for (const p of prods) {
    const v = await db.select({ id: productVersions.id }).from(productVersions).where(eq(productVersions.productId, p.id));
    versCount += v.length;
  }
  const cls = await db.select({ id: clients.id }).from(clients).where(eq(clients.organizationId, o.id)).limit(1);
  console.log(`${o.name} (${o.id}) | products: ${prods.length} | versions: ${versCount} | has clients: ${cls.length > 0}`);
}
process.exit(0);
