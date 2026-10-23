# Changelog

## v1.4.0-vscode

Primeira tranche da nova roadmap: o `audit` agora exporta Markdown, JSON estruturado e SARIF; os relatórios de máquina identificam explicitamente o modo somente leitura e a Fase 5 como excluída. A configuração passa a aceitar `analysis.max_file_size` e `analysis.max_files` para proteger workspaces grandes sem ler arquivos além dos limites definidos.

Foram adicionados testes para os formatos JSON/SARIF e para os limites de workspace. A implementação continua sem execução de Gradle, compilação automática, aplicação de patches ou loop de feedback.

## v1.3.2-vscode

Correções derivadas da revisão completa do toolkit. Revisões Git agora rejeitam argumentos iniciados por opção ou contendo caracteres de controle; o filtro de arquivos alterados também inclui arquivos não rastreados quando não há intervalo explícito. Suppressions usam caminhos relativos exatos, sem correspondência ambígua por basename, e o editor grava o YAML por serialização estruturada.

O fallback Java preserva quebras de linha ao remover comentários e captura as exceções específicas do `javalang`. A detecção de contexto passou a limitar-se a extensões textuais relevantes, arquivos pequenos e diretórios não gerados. A validação de severidade Python foi alinhada à extensão TypeScript.

Foram adicionados testes para fallback, linhas, validações Git, suppressions, severidade e arquivos não rastreados. O relatório [CODE_REVIEW_2026-09-19.md](CODE_REVIEW_2026-09-19.md) documenta os achados e as correções. A Fase 5 continua excluída: não há build, Gradle, patch automático ou loop de compilação.

As verificações locais também executaram `npm audit`; neste ambiente restaram vulnerabilidades transitivas em ferramentas de desenvolvimento (`brace-expansion`, `fast-uri`, `markdown-it`, `qs` e `undici`), sem dependência direta nova vulnerável. A auditoria Gitleaks, Bandit e OpenGrep depende dos executáveis instalados no ambiente; ZAP permanece não aplicável sem um alvo HTTP autorizado.

## v1.3.1-vscode

O scanner Python agora reutiliza regex compiladas, visões lexicais por arquivo e offsets de linha, reduzindo trabalho repetido sem alterar o comportamento somente leitura. A extensão TypeScript reutiliza a base YAML enquanto os arquivos não mudam, compila padrões sob demanda e localiza linhas por busca binária.

A validação de configuração da extensão passou a rejeitar campos desconhecidos, mantendo paridade com o núcleo Python e evitando diagnósticos silenciosamente configurados de forma incorreta. A extensão foi versionada como `1.1.1`.

Não foram adicionados Gradle, execução de builds, aplicação de patches ou qualquer mecanismo da Fase 5.

Após a auditoria de dependências, `js-yaml` foi atualizado para a faixa corrigida `^4.1.1`, removendo a vulnerabilidade alta direta identificada pelo `npm audit`. Permanece uma vulnerabilidade moderada transitiva em `qs`, dependência de ferramenta de desenvolvimento, aguardando atualização compatível do ecossistema.

## v1.1-corrigido

A versão corrigida substitui o parser YAML manual por `PyYAML` com validação de schema, aceita regras aninhadas e listas, rejeita campos desconhecidos e IDs duplicados e valida expressões regulares antes da varredura.

O scanner agora recebe versão de origem, versão de destino e loader; aplica intervalos estruturados e condições legadas; informa regras fora do contexto; rejeita fonte individual que não seja `.java`; ignora comentários e literais quando a regra usa `match_in: code`; suporta `code`, `strings` e `both`; preserva linha e coluna; elimina duplicatas do mesmo achado; e continua somente leitura.

Os relatórios agora mostram contexto completo, confiança editorial, referências, padrão, correspondência, código em bloco seguro para Markdown e regras não aplicadas. A base inicial contém regras exemplificativas para `Commands.literal`, a Flattening de `grass` e a mudança de eventos/modelos, sem aplicar nenhuma reescrita automática.

Foi adicionada uma suíte `unittest` com nove casos cobrindo schema, contexto, loader, filtragem lexical, múltiplos padrões, regex inválida, entrada não-Java, integridade do fonte e relatório.

O projeto continua sem sistema de build automático, sem aplicação de patches e sem execução de comandos externos.

## v1.2-vscode

A base foi reorganizada em arquivos versionados para 1.12→1.13/1.14, 1.16.5→1.17, 1.20.4→1.20.5, 1.20.6→1.21, regras comuns e mudanças específicas do NeoForge 21.x. As novas regras cobrem Flattening, recursos/lang/datapacks, BlockEntity, Java 16/21, ResourceLocation, rendering, GuiGraphics, RecipeInput, DimensionTransition, JukeboxPlayable, Event.Result, ItemAbilities, PlantType, networking e capabilities.

As regras foram alimentadas por primers e páginas oficiais consultadas, com referências em cada regra e notas em `research_sources_notes.md`. A cobertura é incremental e não exaustiva: a ausência de um achado não prova compatibilidade.

Foi adicionada a extensão `vscode-extension/`, com QuickPick para origem/destino e loaders, configurações de workspace, detecção estática de contexto, Problems panel, relatório Markdown e pacote VSIX. Ela lê a base empacotada, não altera fontes, não aplica patches, não executa comandos externos e não implementa a Fase 5 do plano.

Validação da entrega: 10 testes Python passaram, 3 testes do motor TypeScript passaram e o VSIX foi empacotado com sucesso.

## v1.3.0-vscode

A evolução adiciona análise híbrida de estrutura Java com `javalang==0.13.0` e fallback conservador, detecção estática ampliada de Minecraft, loader, Java, mappings, Gradle/plugins e dependências, além de evidências e confiança determinísticas por achado.

O workspace agora aceita `.mod-port-toolkit.yml` e `.mod-port-toolkit-ignore.yml`, percorre Java, recursos e configuração, registra suppressions com justificativa, calcula cobertura conhecida da base, gera relatório `MOD PORT REPORT` e expõe os subcomandos Python `audit`, `coverage` e `compare`. O limiar `severity.fail_on` controla o código de saída da auditoria sem impedir a gravação do relatório.

O schema de regras foi enriquecido com categorias, breaking changes, tipo de migração, APIs/classes/métodos afetados, requisitos de AST/dependências, confiança, referências e sugestões estruturadas. Sugestões, before/after e preview continuam informativos: não há patch, Quick Fix de código ou transformação automática.

A extensão VS Code foi atualizada para a base enriquecida e ganhou comandos de auditoria, cobertura, comparação Git somente leitura, preview de sugestões e registro explícito de suppressions. O manifesto passou a declarar filtros, análise estrutural, dependências, metadados de repositório e testes de integridade do pacote. A validação cobre 19 testes Python e 9 testes Node.

A entrega continua sem build automático, execução de Gradle/Java do mod, sandbox de build, parser de erros de compilação, loop de feedback, aprendizado a partir de compilação ou aplicação automática de patches. Esses itens permanecem excluídos conforme a decisão sobre a Fase 5.
