CREATE TABLE "contract_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contract_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"resource_id" integer NOT NULL,
	"version" varchar(64) NOT NULL,
	"source" text NOT NULL,
	"parameters" jsonb NOT NULL,
	"return_type" text NOT NULL,
	"owner_organization_id" varchar(64),
	"description" text,
	"deployed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "contract_versions_resource_id_version_unique" UNIQUE("resource_id","version")
);
--> statement-breakpoint
ALTER TABLE "resource_functions" ADD COLUMN "price_micro_usd_per_million_tokens" bigint;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "contract_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_resource_id_resources_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE;