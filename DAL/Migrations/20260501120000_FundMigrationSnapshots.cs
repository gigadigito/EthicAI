using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace DAL.Migrations
{
    public partial class FundMigrationSnapshots : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "financial_migration_batch",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    from_mode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    to_mode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    total_users = table.Column<int>(type: "integer", nullable: false),
                    total_available_balance = table.Column<decimal>(type: "decimal(18, 8)", nullable: false),
                    total_locked_balance = table.Column<decimal>(type: "decimal(18, 8)", nullable: false),
                    total_system_balance = table.Column<decimal>(type: "decimal(18, 8)", nullable: false),
                    ledger_last_id = table.Column<int>(type: "integer", nullable: false),
                    batch_hash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    completed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_financial_migration_batch", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "fund_migration_checkpoint",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    batch_id = table.Column<long>(type: "bigint", nullable: false),
                    tx_wallet = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    old_mode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    new_mode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    balance_before = table.Column<decimal>(type: "decimal(18, 8)", nullable: false),
                    locked_balance_before = table.Column<decimal>(type: "decimal(18, 8)", nullable: false),
                    system_balance_before = table.Column<decimal>(type: "decimal(18, 8)", nullable: false),
                    ledger_last_id = table.Column<int>(type: "integer", nullable: false),
                    migration_hash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    completed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_fund_migration_checkpoint", x => x.id);
                    table.ForeignKey(
                        name: "FK_fund_migration_checkpoint_financial_migration_batch_batch_id",
                        column: x => x.batch_id,
                        principalTable: "financial_migration_batch",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_fund_migration_checkpoint_batch_id",
                table: "fund_migration_checkpoint",
                column: "batch_id");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "fund_migration_checkpoint");

            migrationBuilder.DropTable(
                name: "financial_migration_batch");
        }
    }
}
