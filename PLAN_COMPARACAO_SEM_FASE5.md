# Comparação com o Plano Unificado — sem Fase 5

## Escopo adotado

O plano anexado é usado como referência para o toolkit Python, a base versionada e a extensão do VS Code. A **Fase 5 — Loop de Feedback de Compilação** está excluída integralmente. Não haverá execução de `gradlew build`, leitura automática de erros de compilação nem geração dinâmica de regras a partir de builds.

A pesquisa inicial cobre mudanças verificáveis e documentadas nos saltos 1.12→1.13/1.14, 1.16.5→1.17, 1.19.4→1.20, 1.20.4→1.20.5, 1.20.6→1.21, a transição Fabric/Yarn→Mojang Mappings em 26.1 e mudanças específicas do NeoForge 21.x, além de compatibilidade Quilt/Fabric. Os primers oficiais do NeoForge são de alto nível e não exaustivos; portanto, a base registra referências e confiança, mas não promete representar todas as alterações existentes.

## Matriz de alinhamento

| Elemento do plano | Situação atual | Correspondência na extensão | Limite assumido |
|---|---|---|---|
| Base de conhecimento versionada | Implementada em `knowledge-base/rules/*.yaml`, com regras comuns, saltos históricos, 1.20.5, 1.21/26.1 e NeoForge 21.x | A extensão empacota uma cópia da base e carrega todos os YAML | A atualização da base ainda é editorial; não há sincronização automática com documentação externa |
| Schema de regras | Validado com PyYAML no scanner Python e `js-yaml` na extensão | Mesmos campos de versão, loader, severidade, confiança, referências e modo de match | A extensão e o scanner compartilham o contrato, mas não o mesmo código de parser |
| Scanner regex | Implementado, somente leitura, com filtragem de comentários/strings, linha/coluna e regras fora de contexto | Motor TypeScript local para diagnóstico no workspace | Não prova compilação nem semântica completa do Java |
| Detectores de ambiente | Implementados estaticamente para loader, Java, mappings e dependências conhecidas | Contexto é exibido no relatório; seleção manual tem precedência | Detecção textual pode ser inconclusiva ou ambígua e deve ser revisada |
| Analyzer regex/AST | Regex contextual implementada; AST não implementada | A extensão executa análise textual contextual | AST fica como evolução posterior e não é requisito da Fase 5 excluída |
| Patches/suggested changes | Não aplica patches; exemplos `before/after` são documentacionais | Problems panel mostra sugestão textual e o relatório registra referências | Não há alteração automática de fontes nem geração de `.patch` aplicável |
| Relatórios Markdown | Implementados com resumo, achados, confiança, contexto e regras ignoradas | Salvos em `reports/` e podem ser abertos após a análise | Estimativa de horas de trabalho ainda não é calculada automaticamente |
| Exemplos e fixtures | Implementados para Flattening, integração de contexto e testes | Servem como documentação e regressão | Não representam um mod real completo |
| Extensão VS Code | Implementada em `vscode-extension/` | Comandos, QuickPick para versão/loader, configuração de workspace, Problems panel e relatório | Não depende de publicação no Marketplace; instalação é por `.vsix` |
| Pesquisa e referências | Notas em `research_sources_notes.md`; regras apontam para documentação oficial ou referência interna | Referências aparecem no diagnóstico e relatório | “Todas as mudanças” deve ser entendido como cobertura incremental baseada em fontes, não garantia absoluta |
| Fase 5 de compilação | **Ignorada explicitamente** | Não implementada, não executada e não exigida | O produto continua sendo um copiloto estático com revisão humana |

## Fluxo funcional entregue

1. O desenvolvedor abre a pasta raiz do mod no VS Code.
2. Executa `Mod Port Toolkit: Analisar portabilidade`.
3. Escolhe versão de origem, versão de destino, loader de origem e loader de destino.
4. A extensão detecta estaticamente contexto do projeto, carrega a base versionada, filtra regras aplicáveis e varre os arquivos Java.
5. Cada achado é publicado no Problems panel com arquivo, linha, coluna, severidade, código da regra, confiança e sugestão.
6. Um relatório Markdown é gravado em `reports/`, contendo contexto detectado, ocorrências, referências e regras não aplicadas.
7. O desenvolvedor revisa e altera o mod manualmente, fora do escopo desta ferramenta.

## Fontes principais consultadas

- [NeoForge migration primers](https://docs.neoforged.net/primer/docs/), incluindo 1.12→1.13/1.14, 1.16.5→1.17, 1.19.4→1.20, 1.20.6→1.21 e mudanças do NeoForge.
- [Minecraft Java Edition 1.20.5](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-20-5), especialmente Java 21 e versões de Data/Resource Pack.
- [Minecraft Java Edition 1.21](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21), para mudanças técnicas data-driven e changelog da versão.
- [Quilt FAQ](https://quiltmc.org/en/about/faq/), para compatibilidade direcional Quilt/Fabric e descontinuação das Quilt Standard Libraries para novas versões.
- [Fabric porting](https://docs.fabricmc.net/develop/porting/) e [Fabric mappings](https://docs.fabricmc.net/develop/porting/mappings/), para a migração de Yarn para Mojang Mappings a partir de 26.1.
- [VS Code Common Capabilities](https://code.visualstudio.com/api/extension-capabilities/common-capabilities), [VS Code API](https://code.visualstudio.com/api/references/vscode-api) e [Packaging Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension), para QuickPick, comandos, diagnósticos e `.vsix`.

## Próximas extensões compatíveis com o escopo

As evoluções compatíveis com este recorte são ampliar a base por novos primers e releases oficiais, adicionar parser Java/AST, melhorar detectores de dependência e incluir regras Fabric/Quilt específicas com fontes verificadas. Nenhuma dessas evoluções deve executar build ou transformar a extensão em um loop automático de compilação.
