import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";

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
  // For a contract: when its versions were last read from its host. Null if they never could be.
  contractSyncedAt: timestamp("contract_synced_at", { withTimezone: true }),
}, (table) => [
  index("resources_fqn_trgm_idx").using("gin", table.fqn.op("gin_trgm_ops")),
  index("resources_name_trgm_idx").using("gin", table.name.op("gin_trgm_ops")),
]);

// Mirrors `FUNCTION_KINDS` in @registry/types.
export const FUNCTION_KINDS = ['fixed', 'inference', 'contract'] as const;

export const resourceFunctionsTable = pgTable("resource_functions", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  resourceId: integer("resource_id").notNull().references(() => resourcesTable.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  returnType: text("return_type").notNull(),
  description: text(),
  restricted: boolean().notNull().default(false),
  kind: varchar({ length: 16, enum: FUNCTION_KINDS }).notNull().default('fixed'),
  // The function's paymentManifest. All null for a free function. A paid fixed function has a cost,
  // a paid inference function both rates, a contract its price per million script tokens.
  costMicroUsd: bigint("cost_micro_usd", { mode: 'number' }),
  inputCostMicroUsdPerMillionTokens: bigint("input_cost_micro_usd_per_million_tokens", { mode: 'number' }),
  outputCostMicroUsdPerMillionTokens: bigint("output_cost_micro_usd_per_million_tokens", { mode: 'number' }),
  priceMicroUsdPerMillionTokens: bigint("price_micro_usd_per_million_tokens", { mode: 'number' }),
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

/** The deployed versions of a contract, with their source, as its host's `GET /v1/contracts` lists them. */
export const contractVersionsTable = pgTable("contract_versions", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  resourceId: integer("resource_id").notNull().references(() => resourcesTable.id, { onDelete: 'cascade' }),
  version: varchar({ length: 64 }).notNull(),
  source: text().notNull(),
  // `[{ name, type }]`, RequestScript type strings.
  parameters: jsonb().$type<{ name: string; type: string }[]>().notNull(),
  returnType: text("return_type").notNull(),
  ownerOrganizationId: varchar("owner_organization_id", { length: 64 }),
  description: text(),
  // `createdAt` as the host lists it.
  deployedAt: timestamp("deployed_at", { withTimezone: true }).notNull(),
}, (table) => [
  unique("contract_versions_resource_id_version_unique").on(table.resourceId, table.version),
]);

/**
 * Event types, as the node that declared them lists them (`GET /v1/events`). A node also lists the types it
 * learned from peers; the registry believes only the declaring node about a type, as it does for contracts.
 */
export const eventTypesTable = pgTable("event_types", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  path: text().notNull(),
  name: text().notNull(),
  // `path.name`.
  fqn: text().notNull().unique(),
  // The node that declared it, the only one the registry reads it from.
  baseUrl: text("base_url").notNull(),
  hostNodeId: integer("host_node_id").references(() => nodesTable.id, { onDelete: 'set null' }),
  // The organization that owns it, the only one whose nodes may emit it, as its latest version says.
  ownerOrganizationId: varchar("owner_organization_id", { length: 64 }).notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  // Set when its node stops listing it, or the registry stops knowing its node.
  removedAt: timestamp("removed_at", { withTimezone: true }),
}, (table) => [
  index("event_types_fqn_trgm_idx").using("gin", table.fqn.op("gin_trgm_ops")),
]);

/** The declared versions of an event type. Versions are immutable on the node. */
export const eventTypeVersionsTable = pgTable("event_type_versions", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  eventTypeId: integer("event_type_id").notNull().references(() => eventTypesTable.id, { onDelete: 'cascade' }),
  version: varchar({ length: 64 }).notNull(),
  // `[{ name, type }]`, RequestScript type strings.
  fields: jsonb().$type<{ name: string; type: string }[]>().notNull(),
  // Delivered only to event contracts its owner deployed.
  restricted: boolean().notNull(),
  description: text(),
  // `createdAt` as the node lists it.
  declaredAt: timestamp("declared_at", { withTimezone: true }).notNull(),
}, (table) => [
  unique("event_type_versions_event_type_id_version_unique").on(table.eventTypeId, table.version),
]);

/**
 * Event contracts: contracts that run with each event of the type they consume, rather than being called.
 * Nodes leave them out of their resources, so the registry reads them from each node's event announcement
 * (`GET /v1/events/announcement`) and their versions from its `GET /v1/contracts`.
 */
export const eventContractsTable = pgTable("event_contracts", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  path: text().notNull(),
  name: text().notNull(),
  fqn: text().notNull().unique(),
  baseUrl: text("base_url").notNull(),
  hostNodeId: integer("host_node_id").references(() => nodesTable.id, { onDelete: 'set null' }),
  // The event type it consumes, as `path.Name`, and the version. The registry may not know the type.
  eventFqn: text("event_fqn").notNull(),
  eventVersion: varchar("event_version", { length: 64 }).notNull(),
  // Who deployed it, as its node announces. Null when the node doesn't know.
  ownerOrganizationId: varchar("owner_organization_id", { length: 64 }),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  removedAt: timestamp("removed_at", { withTimezone: true }),
}, (table) => [
  index("event_contracts_fqn_trgm_idx").using("gin", table.fqn.op("gin_trgm_ops")),
  index("event_contracts_event_fqn_idx").on(table.eventFqn),
]);

/** The deployed versions of an event contract, with their source, as its node's `GET /v1/contracts` lists them. */
export const eventContractVersionsTable = pgTable("event_contract_versions", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  eventContractId: integer("event_contract_id").notNull().references(() => eventContractsTable.id, { onDelete: 'cascade' }),
  version: varchar({ length: 64 }).notNull(),
  source: text().notNull(),
  ownerOrganizationId: varchar("owner_organization_id", { length: 64 }),
  description: text(),
  deployedAt: timestamp("deployed_at", { withTimezone: true }).notNull(),
}, (table) => [
  unique("event_contract_versions_event_contract_id_version_unique").on(table.eventContractId, table.version),
]);

/**
 * Structs: named shapes of objects that functions, contracts, event types and other structs use as types. A
 * struct's path belongs to one organization, and any of its nodes may declare versions, so the registry reads
 * each version from the node that declared it (`GET /v1/structs`, which also lists those learned from peers).
 */
export const structTypesTable = pgTable("struct_types", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  path: text().notNull(),
  name: text().notNull(),
  // `path.name`.
  fqn: text().notNull().unique(),
  // The organization that owns the path, the only one whose nodes may declare versions of it.
  ownerOrganizationId: varchar("owner_organization_id", { length: 64 }).notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  // Set when no node the registry reads lists a version of it. Its versions are kept.
  removedAt: timestamp("removed_at", { withTimezone: true }),
}, (table) => [
  index("struct_types_fqn_trgm_idx").using("gin", table.fqn.op("gin_trgm_ops")),
]);

/** The declared versions of a struct. Versions are immutable and never deleted on the node. */
export const structTypeVersionsTable = pgTable("struct_type_versions", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  structTypeId: integer("struct_type_id").notNull().references(() => structTypesTable.id, { onDelete: 'cascade' }),
  version: varchar({ length: 64 }).notNull(),
  // `[{ name, type }]`, RequestScript type strings.
  fields: jsonb().$type<{ name: string; type: string }[]>().notNull(),
  description: text(),
  // The node that declared this version, the only one the registry reads it from.
  baseUrl: text("base_url").notNull(),
  hostNodeId: integer("host_node_id").references(() => nodesTable.id, { onDelete: 'set null' }),
  // `createdAt` as the node lists it.
  declaredAt: timestamp("declared_at", { withTimezone: true }).notNull(),
}, (table) => [
  unique("struct_type_versions_struct_type_id_version_unique").on(table.structTypeId, table.version),
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
