-- RequestScript 2.0 (SIP-1): a version lists its functions, not one parameter list. The rows are copies of what
-- hosts list, so the next sync reads them again in the new shape.
DELETE FROM "contract_versions";--> statement-breakpoint
UPDATE "resources" SET "contract_synced_at" = NULL;--> statement-breakpoint
ALTER TABLE "contract_versions" ADD COLUMN "functions" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "resource_functions" ADD COLUMN "payable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_versions" DROP COLUMN "parameters";--> statement-breakpoint
ALTER TABLE "contract_versions" DROP COLUMN "return_type";