# Kwanza Folha

Aplicacao desktop (Electron + React + SQLite) para processamento salarial e operacao de RH em Angola.

## O que o produto faz hoje

- processamento mensal da folha salarial
- calculo fiscal Grupo A (IRT + INSS) com perfil fiscal versionado por vigencia
- assiduidade, faltas, licenças e férias
- processamento de subsídio de férias e subsídio de Natal
- relatórios e documentos PDF
- exportacoes Excel, CSV bancario, PS2 e PSX
- mapa mensal de remuneracoes AGT (geracao e validação assistida)
- auditoria operacional (logs de acoes e exportação CSV/XLS)
- licenciamento local com trial, ativação e renovacao
- backups e restauro de base local

## Trial e licenciamento (estado real)

- trial padrão: **15 dias**
- quando o trial termina, o sistema entra em estado bloqueado para uso comercial
- modo tecnico (`developer-license.json` e `KWANZA_DEV_LICENSE_MODE=1`) so e aceite em runtime local de desenvolvimento
- build empacotada de produção exige fluxo comercial normal de licença

## Arquitetura atual

- Desktop: `electron/main.js`, `electron/preload.js`
- Servicos: `electron/services/*`
- Dominio fiscal: `electron/services/core/fiscal`, `core/irt`, `core/inss`, `core/payroll`
- Persistencia: `electron/services/database.js` + dominos extraidos em `electron/services/core/db/domains`
- Frontend: `src/` (app-shell, features, entities, ui)
- Servidor de licenciamento: **nao incluído neste repositório** (deploy separado)

## Scripts suportados

| Script | Objetivo |
|---|---|
| `npm run dev` | Arranque local (renderer + Electron) |
| `npm run test` | Suite Node principal |
| `npm run test:node:abi` | Rebuild de modulos nativos para Node + testes |
| `npm run integrity:generate` | Atualiza manifesto de integridade |
| `npm run build` | Build desktop geral |
| `npm run build:installer` | Build NSIS |
| `npm run build:signed` | Build assinada (all) |
| `npm run build:signed:installer` | Build assinada (installer) |
| `npm run release:validate` | Validacao preflight de release |
| `npm run release:validate:packaged` | Validacao de artefactos empacotados |
| `npm run release:prepare` | Pipeline local de release estavel |
| `npm run release:prepare:beta` | Pipeline local de release beta |
| `npm run smoke:packaged` | Smoke de boot em build empacotada |
| `npm run smoke:packaged:e2e` | Smoke funcional empacotado |
| `npm run verify:packaged:main` | Verifica sintaxe do main empacotado |
| `npm run report:boot-integrity` | Coleta relatório de arranque/integridade |

## Tipos de build suportados

| Tipo | Suporte |
|---|---|
| NSIS Installer (`KwanzaFolha-Setup-<versao>.exe`) | Suportado |
| Portable | **Não suportado** |

## Fluxo rapido local

1. `npm install`
2. `npm run dev`
3. `npm test`

## Documentacao de entrega

- [docs/README.md](./docs/README.md)
- [Manual do Cliente](./docs/utilizador/MANUAL_CLIENTE.md)
- [IRT 2026 - Fontes e Validacao](./docs/fiscalidade/IRT_2026_FONTES_E_VALIDACAO.md)
- [Validacao por Contabilista](./docs/fiscalidade/VALIDACAO_CONTABILISTA.md)
- [Contrato de Licença](./docs/legal/CONTRATO_LICENCA.md)
- [Termos de Uso](./docs/legal/TERMOS_DE_USO.md)
- [Politica de Privacidade](./docs/legal/POLITICA_PRIVACIDADE.md)
- [Checklist de Entrega](./docs/entrega/CHECKLIST_ENTREGA.md)

## Release final para cliente

Pacote final versionado:

```powershell
npm run release:final
```

O script executa testes, gera instalador unsigned por defeito, copia documentacao de entrega e gera checksums SHA256. Para entrega comercial, assinar digitalmente o instalador e validar fiscalidade/juridico antes de entregar.

## Release (local)

1. validar preflight: `npm run release:validate`
2. gerar release: `npm run release:prepare` ou `npm run release:prepare:beta`
3. validar assinaturas: `powershell -ExecutionPolicy Bypass -File scripts/verify-release-signatures.ps1 -OutputDir dist-electron -RequireTimestamp`
4. confirmar artefactos:
- `dist-electron/KwanzaFolha-Setup-<versao>.exe`
- `dist-electron/KwanzaFolha-Setup-<versao>.exe.blockmap`
- `dist-electron/SHA256SUMS.txt`
- `dist-electron/release-manifest.json`
- `dist-electron/release-notes-template.md`

## Limitacoes atuais conhecidas

- validação oficial AGT depende de homologacao externa em ambiente real
- validação formal de PS2/PSX depende de confirmacao com bancos alvo
- revisão jurídica de todos os documentos emitidos ainda depende de validação humana externa
- `electron/services/database.js`, `electron/main.js` e `electron/services/pdf.js` continuam grandes apesar de extracoes incrementais

## Pre-requisitos para produção

- certificado de code signing valido e segredo protegido
- servidor de licenciamento online com HTTPS e monitorizacao basica
- politica de backup/restauro operacional definida
- suporte tecnico com acesso a bundle de diagnostico
- checklist de release e rollback seguida em todas as publicacoes

## O que depende de validação externa

- parecer contabilístico/fiscal sobre regras e relatarios legais
- validação bancaria dos ficheiros PS2/PSX por instituicao
- validação legal dos templates/documentos emitidos
- aprovação de claims comerciais de conformidade

## Documentacao complementar

- [FISCALIDADE-ANGOLA.md](./FISCALIDADE-ANGOLA.md)
- [COMPLIANCE_GAP_REPORT.md](./COMPLIANCE_GAP_REPORT.md)
- [RELEASE_PROCESS.md](./RELEASE_PROCESS.md)
- [RELEASE-CHECKLIST.md](./RELEASE-CHECKLIST.md)
- [RELEASE-POLICY.md](./RELEASE-POLICY.md)
- [SECURITY.md](./SECURITY.md)
- [SUPPORT_RUNBOOK.md](./SUPPORT_RUNBOOK.md)
- [INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md)
- [LICENSING_OPERATIONS.md](./LICENSING_OPERATIONS.md)
