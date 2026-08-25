# Mod Port Toolkit para VS Code

Extensão do VS Code para analisar estaticamente um workspace de mod Minecraft contra uma versão de origem, uma versão de destino e loaders selecionados. Os achados aparecem no **Problems panel** com arquivo, linha, coluna, severidade, regra, confiança e sugestão. Um relatório Markdown também é salvo em `reports/`.

## Uso

Abra a pasta raiz do mod no VS Code e execute `Mod Port Toolkit: Analisar portabilidade` na Command Palette. A extensão apresenta quatro seletores: versão de origem, versão de destino, loader de origem e loader de destino. A escolha fica salva nas configurações do workspace.

A opção `Mod Port Toolkit: Configurar versões e loaders` salva a configuração sem executar análise. A extensão também permite ajustar os valores em `.vscode/settings.json` usando as chaves `modPortToolkit.sourceVersion`, `modPortToolkit.targetVersion`, `modPortToolkit.sourceLoader` e `modPortToolkit.targetLoader`.

O comando `--detect-context` do scanner Python continua independente. A extensão sempre faz detecção estática local de loader, Java, mappings e dependências para exibir contexto, mas a escolha manual tem precedência para o diagnóstico.

## Escopo e segurança

A extensão somente lê YAML, arquivos Java e metadados textuais do workspace. Ela não edita fontes, não aplica patches, não executa comandos de shell, não executa `gradlew`, não compila o mod e não implementa a Fase 5 do Plano Unificado. A revisão humana continua obrigatória.

A base é deliberadamente não exaustiva. A extensão só deve sugerir uma mudança quando houver uma regra registrada, uma referência e um contexto compatível. Ausência de achados não significa compatibilidade garantida.

## Desenvolvimento

```bash
npm install
npm test
npm run compile
npm run package
```

`npm run package` cria um arquivo `.vsix` na pasta da extensão. No VS Code, use **Extensions → Views and More Actions… → Install from VSIX…** ou execute `code --install-extension <arquivo>.vsix`.

## Estrutura

| Caminho | Finalidade |
|---|---|
| `src/extension.ts` | Comandos, QuickPick, diagnósticos e salvamento do relatório. |
| `src/analysis.ts` | Parser YAML, regras, contexto, filtragem lexical e análise. |
| `test/analysis.test.js` | Testes do motor compilado. |
| `package.json` | Manifest, comandos, configurações e scripts. |
| `dist/` | JavaScript compilado, gerado por `npm run compile`. |
