using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DAL.Migrations
{
    public partial class AddAssetAlertSubscription : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TABLE IF NOT EXISTS "asset_alert_subscription" (
                    "cd_asset_alert_subscription" bigserial PRIMARY KEY,
                    "cd_push_subscription" bigint NOT NULL REFERENCES "push_subscription"("cd_push_subscription") ON DELETE CASCADE,
                    "cd_currency" integer NOT NULL REFERENCES "currency"("cd_currency") ON DELETE CASCADE,
                    "tx_symbol" varchar(50) NOT NULL,
                    "tx_culture" varchar(10) NOT NULL DEFAULT 'en',
                    "is_active" boolean NOT NULL DEFAULT TRUE,
                    "dt_created" timestamp with time zone NOT NULL DEFAULT NOW()
                );
                """);

            migrationBuilder.Sql("""
                CREATE UNIQUE INDEX IF NOT EXISTS "ux_asset_alert_sub_sub_currency"
                    ON "asset_alert_subscription" ("cd_push_subscription", "cd_currency");

                CREATE INDEX IF NOT EXISTS "ix_asset_alert_sub_currency"
                    ON "asset_alert_subscription" ("cd_currency")
                    WHERE "is_active" = TRUE;
                """);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP INDEX IF EXISTS "ix_asset_alert_sub_currency";
                DROP INDEX IF EXISTS "ux_asset_alert_sub_sub_currency";
                DROP TABLE IF EXISTS "asset_alert_subscription";
                """);
        }
    }
}
