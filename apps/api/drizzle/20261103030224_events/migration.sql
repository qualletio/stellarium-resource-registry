CREATE TABLE "event_contract_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_contract_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_contract_id" integer NOT NULL,
	"version" varchar(64) NOT NULL,
	"source" text NOT NULL,
	"owner_organization_id" varchar(64),
	"description" text,
	"deployed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_contract_versions_event_contract_id_version_unique" UNIQUE("event_contract_id","version")
);
--> statement-breakpoint
CREATE TABLE "event_contracts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_contracts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"path" text NOT NULL,
	"name" text NOT NULL,
	"fqn" text NOT NULL UNIQUE,
	"base_url" text NOT NULL,
	"host_node_id" integer,
	"event_fqn" text NOT NULL,
	"event_version" varchar(64) NOT NULL,
	"owner_organization_id" varchar(64),
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "event_type_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_type_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_type_id" integer NOT NULL,
	"version" varchar(64) NOT NULL,
	"fields" jsonb NOT NULL,
	"restricted" boolean NOT NULL,
	"description" text,
	"declared_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_type_versions_event_type_id_version_unique" UNIQUE("event_type_id","version")
);
--> statement-breakpoint
CREATE TABLE "event_types" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"path" text NOT NULL,
	"name" text NOT NULL,
	"fqn" text NOT NULL UNIQUE,
	"base_url" text NOT NULL,
	"host_node_id" integer,
	"owner_organization_id" varchar(64) NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "event_contracts_fqn_trgm_idx" ON "event_contracts" USING gin ("fqn" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "event_contracts_event_fqn_idx" ON "event_contracts" ("event_fqn");--> statement-breakpoint
CREATE INDEX "event_types_fqn_trgm_idx" ON "event_types" USING gin ("fqn" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "event_contract_versions" ADD CONSTRAINT "event_contract_versions_EGhlvGC1283e_fkey" FOREIGN KEY ("event_contract_id") REFERENCES "event_contracts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_contracts" ADD CONSTRAINT "event_contracts_host_node_id_nodes_id_fkey" FOREIGN KEY ("host_node_id") REFERENCES "nodes"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "event_type_versions" ADD CONSTRAINT "event_type_versions_event_type_id_event_types_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "event_types"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_host_node_id_nodes_id_fkey" FOREIGN KEY ("host_node_id") REFERENCES "nodes"("id") ON DELETE SET NULL;