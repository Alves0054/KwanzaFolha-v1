# Release Policy

## Objetivo

Esta politica define como uma release comercial do Kwanza Folha deve ser preparada, assinada, validada e publicada.

## Canais permitidos

- `stable`: release para clientes pagantes e producao
- `beta`: release controlada para pilotos, validacao interna ou clientes selecionados

## Regras obrigatorias

- nenhuma release publica sem assinatura digital valida
- nenhuma release publica sem `SHA256SUMS.txt`
- nenhuma release publica sem `release-manifest.json`
- nenhuma release publica sem `draft` no GitHub para revisao humana final
- nenhuma release `stable` sem testes automatizados concluidos e verificacao funcional minima

## Segredos e certificados

- guardar o certificado PFX fora do repositorio
- usar `KWANZA_CERTIFICATE_PATH` ou `KWANZA_CERTIFICATE_BASE64`
- usar `KWANZA_CERTIFICATE_PASSWORD` em ambiente seguro
- renovar o certificado antes da expiracao e testar a cadeia de confianca
- na GitHub Actions, guardar os segredos com os nomes `KWANZA_CERTIFICATE_BASE64` e `KWANZA_CERTIFICATE_PASSWORD`

## Processo recomendado

1. Atualizar versao e changelog da release.
2. Criar tag `vX.Y.Z` ou `vX.Y.Z-beta.N`.
3. Executar `npm run release:prepare` ou `npm run release:prepare:beta`.
4. Rever `dist-electron/SHA256SUMS.txt`, `release-manifest.json` e `release-notes-template.md`.
5. Publicar a GitHub Release como `draft`.
6. Validar instalacao limpa e upgrade sobre a versao anterior.
7. Publicar a release apenas apos validacao final.

## Politica de rollback

- se a release falhar em producao, retirar a publicacao imediatamente
- preservar a release anterior como ultima versao estavel conhecida
- abrir incidente com causa, impacto, clientes afetados e plano de mitigacao
- nao reaproveitar o mesmo tag para uma correcao; gerar nova versao
