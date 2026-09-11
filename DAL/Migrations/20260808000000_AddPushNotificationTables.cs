using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DAL.Migrations
{
    public partial class AddPushNotificationTables : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Create push_subscription table
            migrationBuilder.Sql("""
                CREATE TABLE IF NOT EXISTS "push_subscription" (
                    "cd_push_subscription" bigserial PRIMARY KEY,
                    "tx_endpoint" text NOT NULL,
                    "tx_p256dh" text NOT NULL,
                    "tx_auth" text NOT NULL,
                    "tx_client_id" text NOT NULL,
                    "cd_user" integer NULL,
                    "dt_created" timestamp with time zone NOT NULL DEFAULT NOW(),
                    "dt_updated" timestamp with time zone NOT NULL DEFAULT NOW(),
                    "is_active" boolean NOT NULL DEFAULT TRUE
                );
                """);

            migrationBuilder.Sql("""
                CREATE UNIQUE INDEX IF NOT EXISTS "ux_push_subscription_endpoint"
                    ON "push_subscription" ("tx_endpoint")
                    WHERE "is_active" = TRUE;

                CREATE INDEX IF NOT EXISTS "ix_push_subscription_client"
                    ON "push_subscription" ("tx_client_id")
                    WHERE "is_active" = TRUE;
                """);

            // Create match_alert_subscription table
            migrationBuilder.Sql("""
                CREATE TABLE IF NOT EXISTS "match_alert_subscription" (
                    "cd_match_alert_subscription" bigserial PRIMARY KEY,
                    "cd_push_subscription" bigint NOT NULL REFERENCES "push_subscription"("cd_push_subscription") ON DELETE CASCADE,
                    "cd_match" integer NOT NULL REFERENCES "match"("cd_match") ON DELETE CASCADE,
                    "is_notify_score" boolean NOT NULL DEFAULT TRUE,
                    "is_notify_comeback" boolean NOT NULL DEFAULT TRUE,
                    "is_notify_finished" boolean NOT NULL DEFAULT TRUE,
                    "tx_culture"                  varchar(10) NOT NULL DEFAULT 'en',
                    "dt_created" timestamp with time zone NOT NULL DEFAULT NOW(),
                    "is_active" boolean NOT NULL DEFAULT TRUE
                );
                """);

            migrationBuilder.Sql("""
                CREATE UNIQUE INDEX IF NOT EXISTS "ux_match_alert_subscription_sub_match"
                    ON "match_alert_subscription" ("cd_push_subscription", "cd_match")
                    WHERE "is_active" = TRUE;

                CREATE INDEX IF NOT EXISTS "ix_match_alert_subscription_match"
                    ON "match_alert_subscription" ("cd_match")
                    WHERE "is_active" = TRUE;
                """);

            // Create match_alert_delivery table
            migrationBuilder.Sql("""
                CREATE TABLE IF NOT EXISTS "match_alert_delivery" (
                    "cd_match_alert_delivery" bigserial PRIMARY KEY,
                    "cd_push_subscription" bigint NOT NULL REFERENCES "push_subscription"("cd_push_subscription") ON DELETE CASCADE,
                    "cd_match" integer NOT NULL REFERENCES "match"("cd_match") ON DELETE CASCADE,
                    "cd_match_score_event" bigint NULL REFERENCES "match_score_event"("cd_match_score_event") ON DELETE SET NULL,
                    "tx_event_key" text NOT NULL,
                    "tx_alert_type" text NOT NULL,
                    "tx_status" text NOT NULL DEFAULT 'PENDING',
                    "nr_attempts" integer NOT NULL DEFAULT 0,
                    "dt_next_attempt" timestamp with time zone NOT NULL DEFAULT NOW(),
                    "dt_last_attempt" timestamp with time zone NULL,
                    "dt_sent" timestamp with time zone NULL,
                    "dt_created" timestamp with time zone NOT NULL DEFAULT NOW()
                );
                """);

            migrationBuilder.Sql("""
                CREATE UNIQUE INDEX IF NOT EXISTS "ux_match_alert_delivery_sub_event_type"
                    ON "match_alert_delivery" ("cd_push_subscription", "tx_event_key", "tx_alert_type");

                CREATE INDEX IF NOT EXISTS "ix_match_alert_delivery_eligible"
                    ON "match_alert_delivery" ("dt_next_attempt")
                    WHERE "tx_status" = 'PENDING';

                CREATE INDEX IF NOT EXISTS "ix_match_alert_delivery_stuck"
                    ON "match_alert_delivery" ("dt_last_attempt")
                    WHERE "tx_status" = 'PROCESSING';
                """);

            // Add comeback detection columns to match_score_state
            migrationBuilder.Sql("""
                ALTER TABLE "match_score_state"
                    ADD COLUMN IF NOT EXISTS "cd_last_undisputed_leader" integer NULL,
                    ADD COLUMN IF NOT EXISTS "nr_last_goal_event_sequence" integer NOT NULL DEFAULT 0;
                """);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Remove comeback detection columns
            migrationBuilder.Sql("""
                ALTER TABLE "match_score_state"
                    DROP COLUMN IF EXISTS "nr_last_goal_event_sequence",
                    DROP COLUMN IF EXISTS "cd_last_undisputed_leader";
                """);

            // Drop match_alert_delivery
            migrationBuilder.Sql("""
                DROP INDEX IF EXISTS "ix_match_alert_delivery_stuck";
                DROP INDEX IF EXISTS "ix_match_alert_delivery_eligible";
                DROP INDEX IF EXISTS "ux_match_alert_delivery_sub_event_type";
                DROP TABLE IF EXISTS "match_alert_delivery";
                """);

            // Drop match_alert_subscription
            migrationBuilder.Sql("""
                DROP INDEX IF EXISTS "ix_match_alert_subscription_match";
                DROP INDEX IF EXISTS "ux_match_alert_subscription_sub_match";
                DROP TABLE IF EXISTS "match_alert_subscription";
                """);

            // Drop push_subscription
            migrationBuilder.Sql("""
                DROP INDEX IF EXISTS "ix_push_subscription_client";
                DROP INDEX IF EXISTS "ux_push_subscription_endpoint";
                DROP TABLE IF EXISTS "push_subscription";
                """);
        }
    }
}
