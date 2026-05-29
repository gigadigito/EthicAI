using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DAL.Migrations
{
    [DbContext(typeof(EthicAIDbContext))]
    [Migration("20260529153000_AddArenaPressureDominanceState")]
    public partial class AddArenaPressureDominanceState : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                ALTER TABLE match_score_state
                    ADD COLUMN IF NOT EXISTS cd_current_pressure_dominance_leader integer NULL;

                ALTER TABLE match_score_state
                    ADD COLUMN IF NOT EXISTS dt_current_pressure_dominance_started timestamp with time zone NULL;

                ALTER TABLE match_score_state
                    ADD COLUMN IF NOT EXISTS fl_current_pressure_dominance_resolved boolean NOT NULL DEFAULT FALSE;

                ALTER TABLE match_score_state
                    ADD COLUMN IF NOT EXISTS fl_current_pressure_dominance_goal_awarded boolean NOT NULL DEFAULT FALSE;
                """);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "cd_current_pressure_dominance_leader",
                table: "match_score_state");

            migrationBuilder.DropColumn(
                name: "dt_current_pressure_dominance_started",
                table: "match_score_state");

            migrationBuilder.DropColumn(
                name: "fl_current_pressure_dominance_resolved",
                table: "match_score_state");

            migrationBuilder.DropColumn(
                name: "fl_current_pressure_dominance_goal_awarded",
                table: "match_score_state");
        }
    }
}
