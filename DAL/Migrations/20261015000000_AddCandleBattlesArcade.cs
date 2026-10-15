using EthicAI.EntityModel;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
namespace DAL.Migrations;

[DbContext(typeof(EthicAIDbContext))]
[Migration("20261015000000_AddCandleBattlesArcade")]
public sealed class AddCandleBattlesArcade : Migration
{
    protected override void Up(MigrationBuilder m)
    {
        m.CreateTable("candle_battles_round", columns: t => new
        {
            MatchId = t.Column<int>(nullable: false),
            OpenTimeUtc = t.Column<DateTime>(type: "timestamp with time zone", nullable: false),
            LeftCandleJson = t.Column<string>(type: "jsonb", nullable: false),
            RightCandleJson = t.Column<string>(type: "jsonb", nullable: false),
            LeftStrength = t.Column<decimal>(type: "numeric(18,10)", nullable: false),
            RightStrength = t.Column<decimal>(type: "numeric(18,10)", nullable: false),
            Winner = t.Column<string>(maxLength: 5, nullable: false),
            RuleVersion = t.Column<string>(maxLength: 80, nullable: false),
            ConfirmedAtUtc = t.Column<DateTime>(type: "timestamp with time zone", nullable: false)
        }, constraints: t =>
        {
            t.PrimaryKey("PK_candle_battles_round", x => new { x.MatchId, x.OpenTimeUtc });
            t.ForeignKey("FK_candle_battles_round_match_MatchId", x => x.MatchId, "match", "cd_match", onDelete: ReferentialAction.Restrict);
            t.CheckConstraint("CK_candle_battles_winner", "\"Winner\" IN ('left', 'right', 'draw')");
        });
        m.CreateTable("candle_battles_state", columns: t => new
        {
            MatchId = t.Column<int>(nullable: false),
            NextOpenUtc = t.Column<DateTime>(type: "timestamp with time zone", nullable: false),
            LeftFormingJson = t.Column<string>(type: "jsonb", nullable: true),
            RightFormingJson = t.Column<string>(type: "jsonb", nullable: true),
            UpdatedAtUtc = t.Column<DateTime>(type: "timestamp with time zone", nullable: false),
            Complete = t.Column<bool>(nullable: false),
            Status = t.Column<string>(maxLength: 32, nullable: false)
        }, constraints: t =>
        {
            t.PrimaryKey("PK_candle_battles_state", x => x.MatchId);
            t.ForeignKey("FK_candle_battles_state_match_MatchId", x => x.MatchId, "match", "cd_match", onDelete: ReferentialAction.Restrict);
        });
        m.CreateIndex("IX_candle_battles_state_Complete_MatchId", "candle_battles_state", new[] { "Complete", "MatchId" });
    }
    protected override void Down(MigrationBuilder m)
    {
        m.DropTable("candle_battles_round");
        m.DropTable("candle_battles_state");
    }
}
