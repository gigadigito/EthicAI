# CriptoVersus.Tests.Integration

Projeto de testes de integracao focado em validar o resultado financeiro das partidas contra a API real do CriptoVersus, sem carteira Solana real e sem chamada blockchain.

## Requisitos

- A API de destino precisa expor os endpoints internos protegidos por chave em `api/internal-test`.
- `CriptoVersusTestSupport:Enabled` deve estar `true` no ambiente alvo.
- `CriptoVersusTestSupport:ApiKey` deve estar configurada.
- Os testes usam wallets com prefixo de teste e nao devem ser executados automaticamente em pipeline.

## Configuracao

Defina no `appsettings.Test.json` ou em variaveis de ambiente:

```powershell
$env:CriptoVersusApi__BaseUrl="https://criptoversus-api.duckdns.org"
$env:CriptoVersusApi__TestApiKey="SUA_CHAVE_DE_TESTE"
$env:CriptoVersusApi__RunProductionIntegrationTests="true"
```

Chaves suportadas:

- `CriptoVersusApi__BaseUrl`
- `CriptoVersusApi__TestApiKey`
- `CriptoVersusApi__WalletPrefix`
- `CriptoVersusApi__DefaultStake`
- `CriptoVersusApi__InitialBalance`
- `CriptoVersusApi__RunProductionIntegrationTests`
- `CriptoVersusApi__HouseFeeRate`
- `CriptoVersusApi__LoserRefundRate`

## Execucao

```powershell
dotnet test C:\EthicAI\EthicAI\CriptoVersus.Tests.Integration\CriptoVersus.Tests.Integration.csproj
```

Os testes sao `opt-in`: se `CriptoVersusApi__RunProductionIntegrationTests` nao estiver `true`, os casos ficam marcados como `Skip`.

## O que os testes auditam

- saldo inicial;
- valor apostado;
- placar final;
- pool do Time A e do Time B;
- taxa da casa;
- loser refund pool;
- payout por usuario;
- saldo apos a aposta e apos o claim;
- ledger disponivel para o usuario de teste.

## Observacao de regra atual

Pela implementacao atual:

- `0x0` gera `DRAW_ZERO_ZERO` com devolucao integral;
- partidas sem contraparte financeira valida geram `NO_BETS_ON_TEAM_A` ou `NO_BETS_ON_TEAM_B` com devolucao integral;
- vitoria com ambos os lados apostados aplica `HouseFeeRate` e `LoserRefundRate`;
- o credito em saldo materializa no `CLAIM`, entao os testes validam tanto a liquidacao (`wallet-history`) quanto o credito efetivo no ledger ao realizar o claim.
