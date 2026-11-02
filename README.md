# Hearing Accessibility Evaluator

Plugin de navegador (Chrome/Edge, Manifest V3) que avalia a página aberta contra critérios de
acessibilidade auditiva (WCAG 2.2, e-MAG 3.1, NBR 17225:2025) e dá uma nota de 0 a 10.
Feito para portais públicos brasileiros: a detecção de texto (transcrição, "ir para o conteúdo",
página de acessibilidade) procura termos em português.

```
extension/
├── manifest.json    activeTab + scripting + storage; host_permissions só para youtube.com
├── evaluator.js     núcleo: roda na página e devolve critérios + nota
├── captions.mjs     lê as faixas de legenda dos vídeos do YouTube e recalcula V1 e a nota
├── popup.html/.js   botão "Evaluate this page", tabela, vídeos verificados, exportar CSV
test/
├── test.mjs         caso conhecido por critério + YouTube simulado + SSRF (sem rede)
├── test-page.html   página usada pelo test.mjs
└── test-popup.mjs   clica "Evaluate this page" no popup real contra um portal
```

## Usar o plugin
1. Chrome → `chrome://extensions` → ligar **Modo do desenvolvedor**.
2. **Carregar sem compactação** → escolher a pasta `extension`.
3. Abrir um portal, clicar no ícone do plugin → **Evaluate this page**.
4. Se a página tiver vídeos ou link para canal do YouTube, o popup consulta cada vídeo
   (canal: os 5 mais recentes) e mostra o tipo de legenda; a nota já vem recalculada.
5. Repetir em outras páginas; **Download CSV** junta todas as avaliações.

## Rodar os testes
```
npm install
set CHROMIUM_PATH=C:\caminho\para\chrome.exe   (ou o Chromium do Playwright)
npm test
npm run test:popup -- [url] [pasta de saída]
```
O `test:popup` usa Porto Alegre por padrão e grava `popup.png` e `popup.csv` em `test/output/`.

## Critérios
| ID | Pergunta | Peso | Automático? |
|---|---|---|---|
| V1 | Vídeos têm legendas? | 3 | `<video>` + `<track>`; YouTube pelas faixas de legenda (manual / automática / nenhuma) |
| V2 | Legendas sincronizadas e manuais? | 2 | Manual |
| V3 | Vídeos têm transcrição? | 3 | Heurística por texto |
| V4 | Ao vivo com legenda em tempo real? | 4 | Manual |
| V5 | Tradução para Libras? | 5 | Detecta VLibras (= parcial); intérprete humano → manual |
| A1 | Áudio tem alternativa em texto? | 3 | Heurística por texto |
| A2 | Nenhum som começa sozinho? | 2 | Sim (`autoplay` sem `muted`) |
| A3 | Dá para pausar e ajustar volume? | 2 | Sim (`controls`; embed do YouTube com `controls=0` = sem controle) |
| A4 | Som de fundo não atrapalha? | 1 | Manual |
| C1 | Botões/links com nome acessível? | 2 | Sim |
| C2 | Clicáveis funcionam pelo teclado? | 2 | Sim (heurística) |
| C3 | Atalhos / "ir para o conteúdo"? | 2 | Sim |
| C4 | Página de acessibilidade? | 1 | Sim |
| C5 | Compreensível sem ouvir? | 3 | Manual |

Status de cada critério: `met` (tem), `partial` (parcial), `not_met` (não tem), `not_applicable`
(não se aplica) e `manual` (conferir à mão). Nota = média ponderada de `met` = 1, `partial` = 0,5 e
`not_met` = 0, só sobre os critérios pontuáveis. Faixas: até 3 pouco acessível, até 5 melhorias
necessárias, até 8 acessível mas pode melhorar, acima de 8 totalmente acessível.

Referências de cada critério (no `evaluator.js`) conferidas em 30/10/2026:
WCAG 2.2 com nível (W3C, 2024); e-MAG 3.1 (5.1, 5.2, 5.4, 1.5, 2.1, 3.5; cap. 4: 4.1 atalhos,
4.5 página de acessibilidade); LBI art. 63 (o art. 67 é radiodifusão); Lei 10.436/2002 art. 2º;
Decreto 5.626/2005. A norma ABNT para web é a NBR 17225:2025 (a NBR 17060:2022 é de apps móveis).

## Regras de legenda (V1 pelo YouTube)
- Faixa com `kind:"asr"` = automática; faixa sem `asr` = enviada pelo órgão; sem faixas = nenhuma.
- Vídeo privado/indisponível fica fora da conta (motivo vai na evidência).
- Todas manuais = tem; alguma manual ou só automáticas = parcial; nenhuma legenda = não tem.
- Só vale o canal/vídeo que o próprio portal linka (ex.: `@caxiasgov` é Caxias/MA, não Caxias do Sul).

## Limitações conhecidas
- O plugin sabe se a legenda existe e se é automática, mas não se está correta, nem se há intérprete no vídeo.
- Por canal, só os 5 vídeos mais recentes são verificados.
- Transcrição é detectada só pela palavra "transcrição" (e variantes) na página.
- O `activeTab` só é concedido quando o usuário clica no ícone. O `test-popup.mjs` contorna isso com uma cópia
  temporária da extensão que pede `<all_urls>`; o resto (popup.js, evaluator.js, captions.mjs) é o código real.
- Segurança: toda busca passa por `safeYoutubeUrl` (só `https://www.youtube.com`); `test.mjs` tenta links
  maliciosos (outro host, 127.0.0.1, `javascript:`, `%2e%2e`) e confere que nenhuma busca sai do YouTube.
