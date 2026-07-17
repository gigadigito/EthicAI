using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DAL.Migrations
{
    public partial class AddCommunityMatchFields : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                ALTER TABLE "match"
                    ADD COLUMN IF NOT EXISTS "in_origin" integer NOT NULL DEFAULT 1,
                    ADD COLUMN IF NOT EXISTS "dt_community_created_at" timestamp with time zone,
                    ADD COLUMN IF NOT EXISTS "cd_created_by_user" integer,
                    ADD COLUMN IF NOT EXISTS "tx_creator_ip_hash" text,
                    ADD COLUMN IF NOT EXISTS "tx_community_pair_key" text;
                """);

            migrationBuilder.Sql("""
                CREATE INDEX IF NOT EXISTS "ix_match_origin" ON "match" ("in_origin");
                CREATE INDEX IF NOT EXISTS "ix_match_community_created_at" ON "match" ("dt_community_created_at");
                CREATE INDEX IF NOT EXISTS "ix_match_creator_ip_hash" ON "match" ("tx_creator_ip_hash");
                CREATE UNIQUE INDEX IF NOT EXISTS "ux_match_community_pair_key_active"
                    ON "match" ("tx_community_pair_key")
                    WHERE "tx_community_pair_key" IS NOT NULL AND "in_status" IN ('Pending', 'Ongoing');
                """);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP INDEX IF EXISTS "ux_match_community_pair_key_active";
                DROP INDEX IF EXISTS "ix_match_creator_ip_hash";
                DROP INDEX IF EXISTS "ix_match_community_created_at";
                DROP INDEX IF EXISTS "ix_match_origin";
                """);

            migrationBuilder.Sql("""
                ALTER TABLE "match"
                    DROP COLUMN IF EXISTS "tx_community_pair_key",
                    DROP COLUMN IF EXISTS "tx_creator_ip_hash",
                    DROP COLUMN IF EXISTS "cd_created_by_user",
                    DROP COLUMN IF EXISTS "dt_community_created_at",
                    DROP COLUMN IF EXISTS "in_origin";
                """);
        }
    }
}
