# CriptoVersus — Price Crossover Social (captura de imagem)

Referência operacional da imagem social do Price Crossover, gerada a partir da página pública e capturada pelo Browserless (n8n).

- Workflow de exemplo: [criptoversus-price-crossover-social-workflow.json](criptoversus-price-crossover-social-workflow.json)

## Página de captura

- Rota pública: `https://www.criptoversus.com/[/{lang}/]social/price-crossover/{matchId}`
  (ex.: `https://www.criptoversus.com/pt/social/price-crossover/41212`)
- Código: `CriptoVersus/Components/Pages/Internet/PriceCrossoverSocial.razor`
- Renderer do gráfico: `CriptoVersus/wwwroot/js/priceCrossoverSocialCard.mjs`
- Modelo/formatos: `CriptoVersus/Services/PriceCrossoverSocialCardModel.cs`

## Presets de imagem

| Preset | Viewport do Browserless | Como pedir | Uso |
|---|---|---|---|
| 4:3 (padrão) | `1200 x 900` | `.../pt/social/price-crossover/{id}` | Binance Square e feeds que aceitam proporção livre |
| 16:9 | `1200 x 675` | `.../pt/social/price-crossover/{id}?preset=16x9` | X/Twitter (múltiplas imagens recomendam 1200×675) |

O card tem tamanho fixo igual ao viewport exportado. Não há recorte nem distorção:
o preset 16:9 é uma composição compactada da mesma peça, não um corte do 4:3.

Ajuste no node Browserless (corpo JSON):

```text
{ url: <publicUrl>, options: { fullPage: false, type: 'png' }, viewport: { width: 1200, height: 900 } }
```

Para 16:9, use `?preset=16x9` na URL e `viewport: { width: 1200, height: 675 }`.

## Cultura e tradução

- A cultura vem do caminho (`/pt/...`, `/en/...`), de `?culture=pt-BR`/`?lang=...`, da
  preferência do usuário (`cv_culture`) ou do `Accept-Language`.
- Fallback final da imagem: `pt-BR`.
- As chaves ficam em `CriptoVersus/i18n.<cultura>.json`, bloco `social.priceCrossover`
  (aninhado, nunca `"chart.title"` plano).
- Validação antes de publicar: `npm run test:i18n` (inclui
  `tools/i18n-price-crossover-validate.mjs`, que falha se alguma chave não resolver em
  qualquer cultura). Em runtime, `detectUnresolvedLocalizationKeys` zera
  `data-social-ready` se alguma chave literal aparecer no DOM.

## Contrato de prontidão para captura

Aguardar `#price-crossover-social-card[data-social-ready="true"]`. O atributo só é
definido quando todos estão satisfeitos:

- `data-capture-state="ready"`
- `data-cs-ready="true"` (modelo completo e publicável)
- `data-render-complete="true"` (canvas pintado)
- `data-fonts-ready="true"` / `data-images-ready="true"`
- `data-i18n-ok="true"` (nenhuma chave de tradução não resolvida)

Não capturar por timeout fixo: sem `data-social-ready` a imagem não deve ser publicada.

## Validação automatizada

```powershell
npm run test:i18n --prefix "CriptoVersus"
npm run test:price-crossover-social --prefix "CriptoVersus"
dotnet test "EthicAI.test/EthicAI.test.csproj" --filter "FullyQualifiedName~PriceCrossoverSocialCardTests"
```

`test:price-crossover-social` gera as páginas com os dados reais da partida 41212
(`tools/price-crossover/fixtures/match-41212.json`), executa a captura Playwright e
grava os PNGs em `tmp/price-crossover-social-captures/`. Os testes cobrem dimensões,
bounds (nenhum elemento ultrapassa o card), scroll, i18n, janela temporal completa e
regressões (símbolos longos, muitos cruzamentos, métricas ausentes).

## Publicação

Workflow, reserva e confirmação continuam em `PriceCrossoverPublicationService`
(`reserve`/`confirm`/`release`, idempotência `price_crossover_highlight:{matchId}`).
Não publicar automaticamente durante testes.


## Autenticacao (n8n + API)

Reserva, confirmacao e liberacao exigem autenticacao (JWT Bearer ou header `X-Social-Key`).
No n8n, use uma credencial do tipo Header Auth (Name: `X-Social-Key`) e nao use
`$env.CV_SOCIAL_API_TOKEN` nos headers.

Configuracao operacional completa (API + n8n): [docs/n8n-price-crossover-auth.md](../../docs/n8n-price-crossover-auth.md)
