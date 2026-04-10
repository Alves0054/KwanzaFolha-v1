# Operacao Rapida

## Primeiro arranque

1. Entrar com `admin / admin123`.
2. Alterar a palavra-passe inicial.
3. Preencher os dados da empresa.
4. Definir a conta de origem para PS2/PSX.
5. Rever os tipos de subsidios, bonus e a tabela de IRT.

## Cadastro minimo antes de processar

Cada funcionario deve ter:

- nome completo
- BI
- NIF
- cargo
- departamento
- salario base
- data de admissao
- banco
- numero da conta bancaria
- IBAN

## Fluxo mensal recomendado

1. Rever alertas do dashboard.
2. Confirmar dados bancarios e legais.
3. Registar eventos do mes.
4. Processar a folha.
5. Rever processamento, descontos e pagamento ao Estado.
6. Gerar relatorios e recibos.
7. Exportar Excel, pacote mensal e ficheiros bancarios.
8. Fechar o periodo.
9. Criar backup manual.

## Recuperacao

- Use a area `Configuracoes > Backups`.
- O sistema cria um backup de seguranca antes de cada restauracao.
- Depois da reposicao, a aplicacao reinicia automaticamente.

## Atualizacoes

- O sistema verifica atualizacoes no arranque.
- Tambem pode verificar manualmente em `Configuracoes`.
- Quando existir nova versao, descarregue o instalador validado e conclua a atualizacao.

## Boas praticas

- nao altere dados estruturais depois de fechar o periodo
- crie backup antes de operacoes sensiveis
- mantenha os dados bancarios dos funcionarios sempre completos e atualizados
- publique releases no GitHub apenas com artefactos assinados e `SHA256SUMS.txt`
