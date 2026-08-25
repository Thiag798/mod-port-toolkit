# Notas de pesquisa — fontes oficiais

## NeoForge Primers

URL: https://docs.neoforged.net/primer/docs/

A página oficial descreve os primers como uma visão geral de alto nível e não exaustiva para migrar mods entre versões do Minecraft. Ela lista saltos documentados de 1.12→1.13/1.14, 1.14→1.15, 1.15.2→1.16.5, 1.16.5→1.17, 1.19.2→1.19.3, 1.19.3→1.19.4, 1.19.4→1.20, 1.20.4→1.20.5, 1.20.5→1.20.6, 1.20.6→1.21 e vários saltos de 1.21.x até 26.2. A própria página informa que, para 1.12–1.17, mudanças vanilla e Forge aparecem combinadas; nos demais casos, mudanças do loader aparecem em subseções próprias. Isso é uma boa fonte para regras versionadas por salto, mas não representa uma lista exaustiva de todas as alterações.

## Fabric Porting

URL: https://docs.fabricmc.net/develop/porting/

A documentação oficial consultada está na versão 26.2 e afirma que o guia cobre a migração de 26.1 para 26.2. Ela orienta atualizar arquivos de configuração do projeto e, separadamente, revisar o código alterado; recomenda consultar o blog do Fabric para mudanças da Fabric API, o artigo oficial do Minecraft para mudanças vanilla e o primer do NeoForge para mudanças vanilla. A estrutura da documentação permite trocar a versão pelo seletor da página, o que será útil para um catálogo de saltos versionado. Trechos que tratam de atualização de build foram registrados apenas como contexto da fonte e não serão implementados no produto, pois o escopo exclui a Fase 5 e qualquer sistema de build automático.

## Implicações para a base

A base não deve prometer “todas as mudanças” como uma coleção absoluta. O modelo correto é um catálogo de regras por salto de versão, loader, categoria, severidade, confiança editorial, referência e padrão. Cada regra precisa indicar se deriva de mudança vanilla ou de mudança do loader e conservar a URL da fonte. O motor deve distinguir regra detectável por regex de regra que exige análise estrutural ou revisão humana.

## Forge Porting Index

URL: https://docs.minecraftforge.net/en/latest/legacy/porting/

O índice oficial do Forge, na documentação exibida para Minecraft 1.21, lista primers de 1.12→1.13/1.14, 1.14→1.15, 1.15→1.16, 1.16→1.17, 1.19.2→1.19.3, 1.19.3→1.19.4, 1.19.4→1.20, 1.20.4→1.20.5/6 e 1.20.6→1.21. O índice informa que algumas versões foram agrupadas quando tiveram menor uso. Isso confirma que a base deve modelar saltos documentados, não assumir que toda versão possui um guia individual.

## Minecraft Java 1.20.5

URL: https://www.minecraft.net/en-us/article/minecraft-java-edition-1-20-5

O artigo oficial lista como mudanças técnicas: o jogo passou a exigir Java 21; a distribuição incluída passou a ser Microsoft OpenJDK 21.0.3; a versão do Data Pack passou a 41; e a versão do Resource Pack passou a 32. A extensão pode mostrar Java mínimo e versões de pack como alertas de ambiente/dados, mas deve manter essas regras separadas das regras específicas de Forge, NeoForge, Fabric ou Quilt.

## Minecraft Java 1.21

URL: https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21

O artigo oficial descreve o retorno a uma abordagem mais data-driven para elementos como encantamentos, pinturas e jukeboxes, além de melhorias de desempenho de carregamento de chunks. A página também disponibiliza uma seção longa de changelog. Para o produto, mudanças vanilla devem ser classificadas por categoria e não misturadas com APIs de loader.

## NeoForge Primer 1.20.6 → 1.21

URL: https://docs.neoforged.net/primer/docs/1.21/

O primer informa que é uma visão de alto nível e não exaustiva e que não trata de um loader específico, concentrando-se em mudanças nas classes vanilla. Os tópicos visíveis incluem Pack Changes, Moving Experimental Features, `ResourceLocation` agora privado, despluralização de pastas de registries/tags, alterações de rendering/vertex system, chunk regions, objetos de datapack de encantamentos, `EnchantmentEffectComponents`, `Enchantment Providers`, painting variants, attribute modifiers com ResourceLocations, `RecipeInput`/`CraftingInput`/`SingleRecipeInput`, mudanças de dimensão, `DecoratedPotPattern`, jukebox playable, reorganização de geração de chunks e mudanças em delta tracker. Esses títulos podem virar categorias e referências na base, mas cada regra deve ser extraída do conteúdo do tópico e marcada como vanilla.

## Quilt FAQ

URL: https://quiltmc.org/en/about/faq/

A FAQ oficial, editada em 3 de fevereiro de 2026, declara que Quilt Loader é compatível com mods Fabric na maioria dos casos, mas não carrega mods Forge/NeoForge. Também informa que Fabric não carrega mods feitos exclusivamente para Quilt e que Quilt Standard Libraries foram descontinuadas em dezembro de 2025 para novas versões, permanecendo disponíveis para versões antigas. A extensão deve tratar a compatibilidade como matriz dirigida: Quilt pode receber muitos mods Fabric, mas isso não autoriza concluir que um mod Quilt roda em Fabric, nem que Forge/NeoForge roda em Quilt.

## VS Code Common Capabilities

URL: https://code.visualstudio.com/api/extension-capabilities/common-capabilities

A documentação oficial do VS Code apresenta `vscode.commands`/`contributes.commands` para comandos, `vscode.QuickPick` para selecionar entre opções, `window.showOpenDialog` para escolher arquivos, `OutputChannel` para logs e notificações para feedback. A extensão usará QuickPick para versões/loaders e a API de diagnósticos para o Problems panel; uma webview só será necessária para uma tela detalhada mais rica.

## VS Code API e empacotamento

URLs: https://code.visualstudio.com/api/references/vscode-api e https://code.visualstudio.com/api/working-with-extensions/publishing-extension

A API oficial expõe `createDiagnosticCollection` para uma coleção de diagnósticos que o editor mostra no Problems panel, além de comandos e QuickPick para interação. A documentação de publicação afirma que o empacotamento cria um arquivo `.vsix` instalável localmente, inclusive sem publicação no Marketplace, usando `vsce package`. A extensão será preparada para esse formato e não exigirá publicação.

## NeoForge 1.20.5 e 1.21 — mudanças de loader

URLs: https://docs.neoforged.net/primer/docs/1.20.5/neo/ e https://docs.neoforged.net/primer/docs/1.21/neo/

A página de NeoForge 1.20.5 mostra tópicos específicos como `neoforge.mods.toml`, atualizações de convenção de tags, componentes de dados de item, networking/stream codecs/custom payloads, rework de API de rede, mudança para Fabric Mixin, refatoração de eventos, serialização de objetos de jogo e GUI layers. A página de NeoForge 1.21 lista mudanças posteriores como rework de registries, capability rework, data maps, networking refactor, segundo networking rework, tick event refactor, remoção de Event.Result, depluralização, encantamentos data-driven, enum extensions rework, damage pipeline rework, substituição de PlantType e renomeação de ToolActions para ItemAbilities. Esses itens devem ser regras de loader separadas das regras vanilla, com versão do NeoForge quando disponível e confiança/referência editorial.

A extensão não vai executar o ciclo de compilação associado a esses temas. O diagnóstico limitar-se-á a localizar APIs, metadados e padrões textuais conhecidos e a mostrar sugestões para revisão humana.

## Fabric — portabilidade e mappings recentes

URLs: https://docs.fabricmc.net/develop/porting/ e https://docs.fabricmc.net/develop/porting/mappings/

A documentação oficial do Fabric consultada é para a migração 26.1→26.2 e recomenda atualizar Minecraft, Fabric Loader, Fabric Loom e Fabric API; para mudanças de código, remete ao blog do Fabric, ao artigo oficial do Minecraft e ao primer NeoForge 26.1→26.2. Isso reforça que a base da extensão deve ser alimentada por saltos explícitos e que não deve inferir uma regra genérica para todas as versões.

A página oficial de mappings informa que, a partir de 26.1, o mod deve migrar de Yarn para Mojang Mappings antes de atualizar; Loom oferece migração semi-automática sem suporte a Kotlin, enquanto Ravel oferece GUI e suporta Kotlin. A página também destaca que 26.1 é unobfuscated e não precisa de mappings de obfuscação. Essa mudança será adicionada como regra de mappings separada, sem executar a tarefa de migração automaticamente.
