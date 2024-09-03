using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NFT_JOGO.Migrations
{
    /// <inheritdoc />
    public partial class NFTDb : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "usuario",
                columns: table => new
                {
                    cd_usuario = table.Column<int>(type: "int", nullable: false).Annotation("SqlServer:Identity", "1, 1"),
                    tx_carterira_endereco = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    nm_jogador = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    dt_atualizacao = table.Column<DateTime>(type: "datetime", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_usuario", x => x.cd_usuario);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "usuario");
        }
    }
}
