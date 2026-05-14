using System;
using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DAL.Migrations
{
    [DbContext(typeof(EthicAIDbContext))]
    [Migration("20260513113000_AddArenaPressureColumnsToMatchScoreState")]
    public partial class AddArenaPressureColumnsToMatchScoreState : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                ALTER TABLE match_score_state
                    ADD COLUMN IF NOT EXISTS nr_pressure_charges_a integer NOT NULL DEFAULT 0;

                ALTER TABLE match_score_state
                    ADD COLUMN IF NOT EXISTS nr_pressure_charges_b integer NOT NULL DEFAULT 0;

                ALTER TABLE match_score_state
                    ADD COLUMN IF NOT EXISTS nr_pressure_goals_awarded integer NOT NULL DEFAULT 0;

                ALTER TABLE match_score_state
                    ADD COLUMN IF NOT EXISTS cd_last_pressure_leader integer NULL;

                ALTER TABLE match_score_state
                    ADD COLUMN IF NOT EXISTS nr_last_pressure_leader_cycles integer NOT NULL DEFAULT 0;

                ALTER TABLE match_score_state
                    ADD COLUMN IF NOT EXISTS dt_last_pressure_goal_a timestamp with time zone NULL;

                ALTER TABLE match_score_state
                    ADD COLUMN IF NOT EXISTS dt_last_pressure_goal_b timestamp with time zone NULL;
                """);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "nr_pressure_charges_a",
                table: "match_score_state");

            migrationBuilder.DropColumn(
                name: "nr_pressure_charges_b",
                table: "match_score_state");

            migrationBuilder.DropColumn(
                name: "nr_pressure_goals_awarded",
                table: "match_score_state");

            migrationBuilder.DropColumn(
                name: "cd_last_pressure_leader",
                table: "match_score_state");

            migrationBuilder.DropColumn(
                name: "nr_last_pressure_leader_cycles",
                table: "match_score_state");

            migrationBuilder.DropColumn(
                name: "dt_last_pressure_goal_a",
                table: "match_score_state");

            migrationBuilder.DropColumn(
                name: "dt_last_pressure_goal_b",
                table: "match_score_state");
        }
    }
}
