# GitHub Secrets Setup

## Segredos obrigatorios

- `KWANZA_CERTIFICATE_BASE64`
- `KWANZA_CERTIFICATE_PASSWORD`

## Preparacao local

1. Confirmar que o certificado existe em `C:\cert\kwanzapro.p12` ou indicar outro caminho.
2. Executar:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\prepare-signing-secrets.ps1 -CertificatePath "C:\cert\kwanzapro.p12" -CopyBase64ToClipboard
```

3. Guardar o conteudo gerado como valor do segredo `KWANZA_CERTIFICATE_BASE64`.
4. Guardar a palavra-passe do `.p12` como valor do segredo `KWANZA_CERTIFICATE_PASSWORD`.

## Onde configurar no GitHub

`Settings > Secrets and variables > Actions > New repository secret`

## Validacao recomendada

- criar uma tag `vX.Y.Z-beta.N` para validar o canal beta
- confirmar que a workflow `Release Desktop` conclui a build assinada
- confirmar que a GitHub Release fica em `draft` com:
  - instalador `.exe`
  - portatil `.exe`
  - `SHA256SUMS.txt`
  - `release-manifest.json`

## Cuidados

- nao guardar o base64 do certificado em ficheiros versionados
- nao partilhar a palavra-passe do certificado em chat, commit ou issue
- apagar os ficheiros temporarios depois da configuracao
