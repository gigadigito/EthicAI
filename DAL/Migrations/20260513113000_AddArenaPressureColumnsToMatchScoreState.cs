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
            migrationBuilder.AddColumn<int>(
                name: "nr_pressure_charges_a",
                table: "match_score_state",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "nr_pressure_charges_b",
                table: "match_score_state",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "nr_pressure_goals_awarded",
                table: "match_score_state",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "cd_last_pressure_leader",
                table: "match_score_state",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "nr_last_pressure_leader_cycles",
                table: "match_score_state",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "dt_last_pressure_goal_a",
                table: "match_score_state",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "dt_last_pressure_goal_b",
                table: "match_score_state",
                type: "timestamp with time zone",
                nullable: true);
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
