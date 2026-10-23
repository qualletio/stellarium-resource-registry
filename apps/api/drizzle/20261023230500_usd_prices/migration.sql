ALTER TABLE "resource_functions" RENAME COLUMN "cost_micro_usdc" TO "cost_micro_usd";--> statement-breakpoint
ALTER TABLE "resource_functions" RENAME COLUMN "input_cost_micro_usdc_per_million_tokens" TO "input_cost_micro_usd_per_million_tokens";--> statement-breakpoint
ALTER TABLE "resource_functions" RENAME COLUMN "output_cost_micro_usdc_per_million_tokens" TO "output_cost_micro_usd_per_million_tokens";--> statement-breakpoint
ALTER TABLE "resource_functions" RENAME COLUMN "recipient_address" TO "recipient_organization_id";