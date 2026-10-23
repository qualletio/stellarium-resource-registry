import { bigint, boolean, index, integer, pgTable, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";

/**
 * Stellarium nodes the registry knows: the source node it syncs from, the source's peers, and
 * any other host a resource points at.
 */
export const nodesTable = pgTable("nodes", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  baseUrl: text("base_url").notNull().unique(),
  name: text(),
  publicKey: text("public_key"),
  isSource: boolean("is_source").notNull().default(false),
  // Null until a restricted function on the node has been probed.
  acceptsGrantRequests: boolean("accepts_grant_requests"),
  grantEndpoint: text("grant_endpoint"),
  grantProbedAt: timestamp("grant_probed_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const resourcesTable = pgTable("resources", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  path: text().notNull(),
  name: text().notNull(),
  // `path.name`. Unique on a node, since `getResource` looks resources up by it.
  fqn: text().notNull().unique(),
  baseUrl: text("base_url").notNull(),
  // An http(s) URL, as the node lists it.
  website: text(),
  description: text(),
  // sha256 of the functions as last synced. Functions are only rewritten when it changes.
  functionsHash: varchar("functions_hash", { length: 64 }).notNull(),
  hostNodeId: integer("host_node_id").references(() => nodesTable.id, { onDelete: 'set null' }),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  // Set when the source node stops listing the resource. Kept so a flaky sync doesn't wipe the registry.
  removedAt: timestamp("removed_at", { withTimezone: true }),
}, (table) => [
  index("resources_fqn_trgm_idx").using("gin", table.fqn.op("gin_trgm_ops")),
  index("resources_name_trgm_idx").using("gin", table.name.op("gin_trgm_ops")),
]);

// Mirrors `FUNCTION_KINDS` in @registry/types.
export const FUNCTION_KINDS = ['fixed', 'inference'] as const;

export const resourceFunctionsTable = pgTable("resource_functions", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  resourceId: integer("resource_id").notNull().references(() => resourcesTable.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  returnType: text("return_type").notNull(),
  description: text(),
  restricted: boolean().notNull().default(false),
  kind: varchar({ length: 16, enum: FUNCTION_KINDS }).notNull().default('fixed'),
  // The function's paymentManifest. All null for a free function. A paid fixed function has a cost,
  // a paid inference function both rates.
  costMicroUsd: bigint("cost_micro_usd", { mode: 'number' }),
  inputCostMicroUsdPerMillionTokens: bigint("input_cost_micro_usd_per_million_tokens", { mode: 'number' }),
  outputCostMicroUsdPerMillionTokens: bigint("output_cost_micro_usd_per_million_tokens", { mode: 'number' }),
  recipientOrganizationId: varchar("recipient_organization_id", { length: 64 }),
  // Order the node listed the function in.
  position: integer().notNull(),
}, (table) => [
  unique("resource_functions_resource_id_name_unique").on(table.resourceId, table.name),
  index("resource_functions_name_trgm_idx").using("gin", table.name.op("gin_trgm_ops")),
]);

export const functionParametersTable = pgTable("function_parameters", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  functionId: integer("function_id").notNull().references(() => resourceFunctionsTable.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  type: text().notNull(),
  description: text(),
  position: integer().notNull(),
}, (table) => [
  index("function_parameters_function_id_idx").on(table.functionId),
]);

export const SYNC_RUN_STATUSES = ['running', 'succeeded', 'failed'] as const;
export type SyncRunStatus = typeof SYNC_RUN_STATUSES[number];

export const syncRunsTable = pgTable("sync_runs", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  sourceUrl: text("source_url").notNull(),
  status: varchar({ length: 16, enum: SYNC_RUN_STATUSES }).notNull().default('running'),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  resourcesSeen: integer("resources_seen").notNull().default(0),
  resourcesAdded: integer("resources_added").notNull().default(0),
  resourcesRemoved: integer("resources_removed").notNull().default(0),
  error: text(),
});
