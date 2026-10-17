CREATE TABLE "function_parameters" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "function_parameters_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"function_id" integer NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "nodes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"base_url" text NOT NULL UNIQUE,
	"name" text,
	"public_key" text,
	"is_source" boolean DEFAULT false NOT NULL,
	"accepts_grant_requests" boolean,
	"grant_endpoint" text,
	"grant_probed_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_functions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "resource_functions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"resource_id" integer NOT NULL,
	"name" text NOT NULL,
	"return_type" text NOT NULL,
	"restricted" boolean DEFAULT false NOT NULL,
	"cost_lamports" bigint,
	"recipient_address" varchar(64),
	"position" integer NOT NULL,
	CONSTRAINT "resource_functions_resource_id_name_unique" UNIQUE("resource_id","name")
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "resources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"path" text NOT NULL,
	"name" text NOT NULL,
	"fqn" text NOT NULL UNIQUE,
	"base_url" text NOT NULL,
	"functions_hash" varchar(64) NOT NULL,
	"host_node_id" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_url" text NOT NULL,
	"status" varchar(16) DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"resources_seen" integer DEFAULT 0 NOT NULL,
	"resources_added" integer DEFAULT 0 NOT NULL,
	"resources_removed" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE INDEX "function_parameters_function_id_idx" ON "function_parameters" ("function_id");--> statement-breakpoint
CREATE INDEX "resource_functions_name_trgm_idx" ON "resource_functions" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "resources_fqn_trgm_idx" ON "resources" USING gin ("fqn" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "resources_name_trgm_idx" ON "resources" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "function_parameters" ADD CONSTRAINT "function_parameters_function_id_resource_functions_id_fkey" FOREIGN KEY ("function_id") REFERENCES "resource_functions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "resource_functions" ADD CONSTRAINT "resource_functions_resource_id_resources_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_host_node_id_nodes_id_fkey" FOREIGN KEY ("host_node_id") REFERENCES "nodes"("id") ON DELETE SET NULL;