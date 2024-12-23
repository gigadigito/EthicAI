using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace DAL.Migrations
{
    /// <inheritdoc />
    public partial class EthicAIMigration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "currency",
                columns: table => new
                {
                    cd_currency = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    tx_name = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    tx_symbol = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    nr_percentage_change = table.Column<decimal>(type: "decimal(5,2)", nullable: false),
                    dt_last_updated = table.Column<DateTime>(type: "datetime", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_currency", x => x.cd_currency);
                });

            migrationBuilder.CreateTable(
                name: "post_category",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false),
                    tx_name = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_post_category", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "user",
                columns: table => new
                {
                    cd_user = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    tx_wallet = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    nm_name = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    tx_email = table.Column<string>(type: "nvarchar(254)", maxLength: 254, nullable: true),
                    dt_update = table.Column<DateTime>(type: "datetime", nullable: false),
                    is_human = table.Column<bool>(type: "bit", nullable: true),
                    tx_human_captcha = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    dt_human_validation = table.Column<DateTime>(type: "datetime", nullable: true),
                    dt_create = table.Column<DateTime>(type: "datetime2", nullable: false),
                    dt_last_login = table.Column<DateTime>(type: "datetime", nullable: true),
                    nm_ia = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    nm_human_representative = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    nm_company = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    nm_ia_model = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    nr_balance = table.Column<decimal>(type: "decimal(18,2)", nullable: false, defaultValue: 0m)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user", x => x.cd_user);
                });

            migrationBuilder.CreateTable(
                name: "team",
                columns: table => new
                {
                    cd_team = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    cd_currency = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_team", x => x.cd_team);
                    table.ForeignKey(
                        name: "FK_team_currency_cd_currency",
                        column: x => x.cd_currency,
                        principalTable: "currency",
                        principalColumn: "cd_currency",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "post",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    tx_title = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    tx_url = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    tx_content = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    dt_post = table.Column<DateTime>(type: "datetime", nullable: false),
                    aq_image = table.Column<byte[]>(type: "varbinary(max)", nullable: false),
                    post_category_id = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_post", x => x.Id);
                    table.ForeignKey(
                        name: "FK_post_post_category_post_category_id",
                        column: x => x.post_category_id,
                        principalTable: "post_category",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pre_sale_purchase",
                columns: table => new
                {
                    id_purchase = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    user_id = table.Column<int>(type: "int", nullable: false),
                    sol_amount = table.Column<decimal>(type: "decimal(18,8)", nullable: false),
                    ethic_ai_amount = table.Column<decimal>(type: "decimal(18,8)", nullable: false),
                    purchase_date = table.Column<DateTime>(type: "datetime", nullable: false),
                    transaction_hash = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pre_sale_purchase", x => x.id_purchase);
                    table.ForeignKey(
                        name: "FK_pre_sale_purchase_user_user_id",
                        column: x => x.user_id,
                        principalTable: "user",
                        principalColumn: "cd_user",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "match",
                columns: table => new
                {
                    cd_match = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    dt_start_time = table.Column<DateTime>(type: "datetime", nullable: true),
                    dt_end_time = table.Column<DateTime>(type: "datetime", nullable: true),
                    cd_team_a = table.Column<int>(type: "int", nullable: false),
                    cd_team_b = table.Column<int>(type: "int", nullable: false),
                    nr_score_a = table.Column<int>(type: "int", nullable: false),
                    nr_score_b = table.Column<int>(type: "int", nullable: false),
                    in_status = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_match", x => x.cd_match);
                    table.ForeignKey(
                        name: "FK_match_team_cd_team_a",
                        column: x => x.cd_team_a,
                        principalTable: "team",
                        principalColumn: "cd_team",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_match_team_cd_team_b",
                        column: x => x.cd_team_b,
                        principalTable: "team",
                        principalColumn: "cd_team",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "bet",
                columns: table => new
                {
                    cd_bet = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    cd_match = table.Column<int>(type: "int", nullable: false),
                    cd_team = table.Column<int>(type: "int", nullable: false),
                    cd_user = table.Column<int>(type: "int", nullable: false),
                    nr_amount = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                    dt_bet_time = table.Column<DateTime>(type: "datetime", nullable: false),
                    is_claimed = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                    dt_claimed_at = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_bet", x => x.cd_bet);
                    table.ForeignKey(
                        name: "FK_bet_match_cd_match",
                        column: x => x.cd_match,
                        principalTable: "match",
                        principalColumn: "cd_match",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_bet_team_cd_team",
                        column: x => x.cd_team,
                        principalTable: "team",
                        principalColumn: "cd_team",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_bet_user_cd_user",
                        column: x => x.cd_user,
                        principalTable: "user",
                        principalColumn: "cd_user",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "post_category",
                columns: new[] { "Id", "tx_name" },
                values: new object[,]
                {
                    { 1, "Technology" },
                    { 2, "Science" },
                    { 3, "Health" },
                    { 4, "Education" },
                    { 5, "Business" }
                });

            migrationBuilder.CreateIndex(
                name: "IX_bet_cd_match",
                table: "bet",
                column: "cd_match");

            migrationBuilder.CreateIndex(
                name: "IX_bet_cd_team",
                table: "bet",
                column: "cd_team");

            migrationBuilder.CreateIndex(
                name: "IX_bet_cd_user",
                table: "bet",
                column: "cd_user");

            migrationBuilder.CreateIndex(
                name: "IX_match_cd_team_a",
                table: "match",
                column: "cd_team_a");

            migrationBuilder.CreateIndex(
                name: "IX_match_cd_team_b",
                table: "match",
                column: "cd_team_b");

            migrationBuilder.CreateIndex(
                name: "IX_post_post_category_id",
                table: "post",
                column: "post_category_id");

            migrationBuilder.CreateIndex(
                name: "IX_pre_sale_purchase_user_id",
                table: "pre_sale_purchase",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_team_cd_currency",
                table: "team",
                column: "cd_currency");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "bet");

            migrationBuilder.DropTable(
                name: "post");

            migrationBuilder.DropTable(
                name: "pre_sale_purchase");

            migrationBuilder.DropTable(
                name: "match");

            migrationBuilder.DropTable(
                name: "post_category");

            migrationBuilder.DropTable(
                name: "user");

            migrationBuilder.DropTable(
                name: "team");

            migrationBuilder.DropTable(
                name: "currency");
        }
    }
}
