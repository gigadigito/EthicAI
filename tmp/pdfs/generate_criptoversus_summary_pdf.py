from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "Itens de Solução"
PNG_DIR = ROOT / "tmp" / "pdfs"
PDF_PATH = OUT_DIR / "CriptoVersus-One-Page-Summary.pdf"
PNG_PATH = PNG_DIR / "CriptoVersus-One-Page-Summary.png"

PAGE_W = 1700
PAGE_H = 2200
MARGIN_X = 120
MARGIN_Y = 110

BG = "#f7f8fb"
PANEL = "#ffffff"
TEXT = "#102034"
MUTED = "#5c6b80"
ACCENT = "#0f766e"
ACCENT_SOFT = "#d9f3ef"
RULE = "#d8e1ea"


def load_font(size: int, bold: bool = False):
    candidates = []
    if bold:
        candidates.extend(
            [
                "C:/Windows/Fonts/segoeuib.ttf",
                "C:/Windows/Fonts/arialbd.ttf",
                "C:/Windows/Fonts/calibrib.ttf",
            ]
        )
    candidates.extend(
        [
            "C:/Windows/Fonts/segoeui.ttf",
            "C:/Windows/Fonts/arial.ttf",
            "C:/Windows/Fonts/calibri.ttf",
        ]
    )
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default()


FONT_TITLE = load_font(56, bold=True)
FONT_SUB = load_font(24)
FONT_H = load_font(28, bold=True)
FONT_BODY = load_font(22)
FONT_BODY_BOLD = load_font(22, bold=True)
FONT_SMALL = load_font(18)


def text_size(draw: ImageDraw.ImageDraw, text: str, font):
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0], box[3] - box[1]


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font, max_width: int):
    words = text.split()
    lines = []
    current = ""
    for word in words:
        test = word if not current else f"{current} {word}"
        if text_size(draw, test, font)[0] <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def draw_wrapped(draw, text, x, y, font, fill, max_width, line_gap=8):
    lines = wrap_text(draw, text, font, max_width)
    line_h = text_size(draw, "Ag", font)[1]
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        y += line_h + line_gap
    return y


def draw_bullets(draw, items, x, y, width, bullet_color=ACCENT):
    bullet_r = 5
    line_h = text_size(draw, "Ag", FONT_BODY)[1]
    for item in items:
        draw.ellipse((x, y + 9, x + bullet_r * 2, y + 9 + bullet_r * 2), fill=bullet_color)
        lines = wrap_text(draw, item, FONT_BODY, width - 28)
        text_y = y
        for line in lines:
            draw.text((x + 24, text_y), line, font=FONT_BODY, fill=TEXT)
            text_y += line_h + 6
        y = text_y + 8
    return y


def section_title(draw, title, x, y):
    draw.text((x, y), title, font=FONT_H, fill=ACCENT)
    _, h = text_size(draw, title, FONT_H)
    draw.line((x, y + h + 10, x + 180, y + h + 10), fill=ACCENT, width=3)
    return y + h + 26


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PNG_DIR.mkdir(parents=True, exist_ok=True)

    img = Image.new("RGB", (PAGE_W, PAGE_H), BG)
    draw = ImageDraw.Draw(img)

    draw.rounded_rectangle((70, 70, PAGE_W - 70, PAGE_H - 70), radius=36, fill=PANEL, outline=RULE, width=2)
    draw.rounded_rectangle((MARGIN_X, MARGIN_Y, PAGE_W - MARGIN_X, 235), radius=22, fill=ACCENT_SOFT)

    draw.text((MARGIN_X + 34, MARGIN_Y + 24), "CriptoVersus", font=FONT_TITLE, fill=TEXT)
    draw.text(
        (MARGIN_X + 36, MARGIN_Y + 106),
        "One-page repo summary based on code, config, and solution files",
        font=FONT_SUB,
        fill=MUTED,
    )

    left_x = MARGIN_X
    col_gap = 70
    col_w = (PAGE_W - (MARGIN_X * 2) - col_gap) // 2
    right_x = left_x + col_w + col_gap
    y_left = 285
    y_right = 285

    y_left = section_title(draw, "What it is", left_x, y_left)
    what_it_is = (
        "CriptoVersus is a .NET 8 app that turns short-term crypto market performance into head-to-head "
        "matches where users allocate SOL-backed positions to token sides."
    )
    y_left = draw_wrapped(draw, what_it_is, left_x, y_left, FONT_BODY, TEXT, col_w, line_gap=7)
    y_left += 10
    what_it_is_2 = (
        "The repo shows a Blazor front end, an authenticated API, a background worker that builds and settles "
        "matches, and an optional Solana devnet betting program."
    )
    y_left = draw_wrapped(draw, what_it_is_2, left_x, y_left, FONT_BODY, TEXT, col_w, line_gap=7)
    y_left += 28

    y_left = section_title(draw, "Who it's for", left_x, y_left)
    persona = (
        "Primary persona: a crypto-native user with a Solana wallet who wants to track token-vs-token matchups, "
        "place SOL-based bets or recurring positions, and review outcomes in a wallet dashboard."
    )
    y_left = draw_wrapped(draw, persona, left_x, y_left, FONT_BODY, TEXT, col_w, line_gap=7)
    y_left += 28

    y_left = section_title(draw, "What it does", left_x, y_left)
    features = [
        "Shows a live dashboard of top gainers, pending matches, ongoing matches, completed matches, and worker health.",
        "Authenticates users with Solana wallet signature login and stores JWT-backed sessions.",
        "Lets users invest on a token side, with support for system balance or on-chain transaction signatures.",
        "Tracks wallet balances, active positions, grouped history, payouts, refunds, and match-level settlement detail.",
        "Publishes tokenomics and protocol rules, including fee splits, auto re-entry, and on-chain program metadata.",
        "Provides admin/system views for privileged wallets and recent position monitoring.",
        "Supports match score rebuilds, score events, metric snapshots, and SignalR-driven UI refreshes.",
    ]
    y_left = draw_bullets(draw, features, left_x, y_left, col_w)

    y_right = section_title(draw, "How it works", right_x, y_right)
    architecture = [
        "Web UI: `CriptoVersus` is a Blazor Server app with Razor components, session storage, JS wallet helpers, and a SignalR client.",
        "API: `CriptoVersus.API` exposes controllers for dashboard, matches, bets, wallet, tokenomics, login, worker status, and admin data.",
        "Worker: `CriptoVersus.Worker` polls Binance 24h ticker data, builds match pools, advances match states, scores outcomes, and settles capital.",
        "Data layer: Entity Framework Core with `EthicAIDbContext` and PostgreSQL-backed entities for users, matches, bets, currencies, ledgers, and positions.",
        "Realtime flow: worker/API send dashboard notifications through `/hubs/dashboard`; the web client reloads snapshots when events arrive.",
        "On-chain piece: `solana/criptoversus_betting` contains an Anchor devnet escrow program for match creation, betting, settlement, and payout claims.",
    ]
    y_right = draw_bullets(draw, architecture, right_x, y_right, col_w)
    y_right += 10

    y_right = section_title(draw, "How to run", right_x, y_right)
    steps = [
        "Prereqs from repo evidence: .NET 8 SDK, PostgreSQL connection string/user secrets for API and Worker, and optional Node/TypeScript for JS builds.",
        "Restore/build the projects: `dotnet restore` and `dotnet build` for `CriptoVersus.API`, `CriptoVersus.Worker`, and `CriptoVersus/CriptoVersus.Web.csproj`.",
        "Start the API, Worker, and Web app in separate terminals with `dotnet run --project ...` for each project.",
        "Open the web app, sign in with a Solana wallet, and ensure the API base URL/config points to the running API.",
        "Not found in repo: a local `docker-compose.yml`, seeded local database instructions, and a single documented end-to-end bootstrap script.",
    ]
    y_right = draw_bullets(draw, steps, right_x, y_right, col_w)

    footer = (
        "Evidence used: `EthicAI.sln`, project `Program.cs` files, API controllers, worker logic, Razor pages, "
        "`appsettings.json`, `CMD_SUBIR.txt`, and `solana/criptoversus_betting/README.md`."
    )
    footer_y = PAGE_H - 180
    draw.line((MARGIN_X, footer_y - 22, PAGE_W - MARGIN_X, footer_y - 22), fill=RULE, width=2)
    draw.text((MARGIN_X, footer_y), footer, font=FONT_SMALL, fill=MUTED)

    img.save(PNG_PATH)
    img.save(PDF_PATH, "PDF", resolution=150.0)

    print(PDF_PATH)
    print(PNG_PATH)


if __name__ == "__main__":
    main()
