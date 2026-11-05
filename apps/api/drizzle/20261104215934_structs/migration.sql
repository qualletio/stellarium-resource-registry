CREATE TABLE "struct_type_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "struct_type_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"struct_type_id" integer NOT NULL,
	"version" varchar(64) NOT NULL,
	"fields" jsonb NOT NULL,
	"description" text,
	"base_url" text NOT NULL,
	"host_node_id" integer,
	"declared_at" timestamp with time zone NOT NULL,
	CONSTRAINT "struct_type_versions_struct_type_id_version_unique" UNIQUE("struct_type_id","version")
);
--> statement-breakpoint
CREATE TABLE "struct_types" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "struct_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"path" text NOT NULL,
	"name" text NOT NULL,
	"fqn" text NOT NULL UNIQUE,
	"owner_organization_id" varchar(64) NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "struct_types_fqn_trgm_idx" ON "struct_types" USING gin ("fqn" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "struct_type_versions" ADD CONSTRAINT "struct_type_versions_struct_type_id_struct_types_id_fkey" FOREIGN KEY ("struct_type_id") REFERENCES "struct_types"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "struct_type_versions" ADD CONSTRAINT "struct_type_versions_host_node_id_nodes_id_fkey" FOREIGN KEY ("host_node_id") REFERENCES "nodes"("id") ON DELETE SET NULL;