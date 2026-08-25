# Changelog

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
