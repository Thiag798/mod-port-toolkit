# Mod Port Toolkit para VS Code

Extensão do VS Code para analisar estaticamente um workspace de mod Minecraft contra uma versão de origem, uma versão de destino e loaders selecionados. Os achados aparecem no **Problems panel** com arquivo, linha, coluna, severidade, categoria, regra, confiança e evidências. Um relatório Markdown também é salvo em `reports/`.

## Uso

Abra a pasta raiz do mod no VS Code e execute `Mod Port Toolkit: Analisar portabilidade` na Command Palette. A extensão apresenta seletores para versão de origem, versão de destino, loader de origem e loader de destino. A escolha fica salva nas configurações do workspace.

`Mod Port Toolkit: Executar auditoria` executa o mesmo motor sem repetir os QuickPick, usando as configurações atuais e o `.mod-port-toolkit.yml` do projeto. `Ver cobertura da base` grava `reports/coverage.json`, mostrando quantas regras carregadas são aplicáveis ao contexto. Essa métrica mede cobertura conhecida da base, não compatibilidade total.

`Comparar commits Git` solicita base e head e lista o resultado de `git diff --name-status`. A operação é somente leitura: não faz checkout, commit, reset, stage ou alteração no repositório. `Visualizar sugestão sem alterar arquivos` mostra antes/depois, API de substituição e nível de segurança de uma sugestão estruturada, sem criar patch nem editar fonte.

A ação de código `Ignorar <regra> com justificativa` pede uma razão e registra uma suppression pontual em `.mod-port-toolkit-ignore.yml`. O arquivo é carregado na próxima análise e as suppressions são listadas no relatório. Não existe Quick Fix para alterar o código-fonte.

As configurações podem ser escritas em `.vscode/settings.json`:

```json
{
  "modPortToolkit.sourceVersion": "1.20.1",
  "modPortToolkit.targetVersion": "1.21.1",
  "modPortToolkit.sourceLoader": "forge",
  "modPortToolkit.targetLoader": "neoforge",
  "modPortToolkit.ast": true,
  "modPortToolkit.dependencies": true,
  "modPortToolkit.minimumSeverity": "info",
  "modPortToolkit.breakingChangesOnly": false,
  "modPortToolkit.changedFilesOnly": false
}
```

A análise estrutural Java é conservadora e offline. Ela extrai imports, tipos, métodos, chamadas e annotations com um parser lexical/estrutural equivalente ao contrato Python; não executa Java nem o projeto. Comentários são removidos da visão `code`, e literais podem ser selecionados por `strings` ou `both` conforme a regra.

## Escopo e segurança

A extensão somente lê YAML, arquivos Java e metadados textuais do workspace, além de invocar Git para consultas de diff. Ela não edita fontes, não aplica patches, não executa scripts do projeto, não executa `gradlew`, não compila o mod e não implementa a Fase 5 do plano de referência. A revisão humana continua obrigatória.

A base é deliberadamente não exaustiva. A extensão só deve sugerir uma mudança quando houver uma regra registrada, referência e contexto compatível. Ausência de achados não significa compatibilidade garantida. A confiança exibida é um sinal de priorização editorial e de evidência, não uma prova estatística.

## Desenvolvimento

```bash
npm install
npm test
npm run compile
npm run package
```

`npm test` compila o TypeScript e executa testes do motor, cobertura e manifesto. `npm run package` cria um arquivo `.vsix` na pasta da extensão. No VS Code, use **Extensions → Views and More Actions… → Install from VSIX…** ou execute `code --install-extension <caminho-completo-do-arquivo.vsix>`. O pacote não é publicado automaticamente no Marketplace.

Para testes manuais completos, use o comando **Run Extension** em um Extension Development Host. Uma futura publicação no Marketplace deve continuar sendo uma ação manual do mantenedor, após revisão do publisher, identidade e política de distribuição.

## Estrutura

| Caminho | Finalidade |
|---|---|
| `src/extension.ts` | Comandos, QuickPick, filtros, diagnósticos, preview e suppressions. |
| `src/analysis.ts` | Schema YAML, contexto, parser estrutural, evidências, análise e Git somente leitura. |
| `knowledge-base/rules/` | Cópia empacotada da base editorial para uso offline. |
| `test/analysis.test.js` | Testes do motor compilado, contexto e cobertura. |
| `test/manifest.test.js` | Testes do manifesto e do conteúdo esperado do VSIX. |
| `package.json` | Manifesto, comandos, configurações e scripts. |
| `dist/` | JavaScript compilado, gerado por `npm run compile`. |
