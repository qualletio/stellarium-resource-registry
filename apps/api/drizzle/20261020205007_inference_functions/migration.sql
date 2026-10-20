ALTER TABLE "resource_functions" ADD COLUMN "kind" varchar(16) DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "resource_functions" ADD COLUMN "input_cost_micro_usdc_per_million_tokens" bigint;--> statement-breakpoint
ALTER TABLE "resource_functions" ADD COLUMN "output_cost_micro_usdc_per_million_tokens" bigint;