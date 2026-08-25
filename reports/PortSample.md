# Relatório de Portabilidade — PortSample

- **Origem analisada:** `tests`
- **Versão de origem:** `1.12.2`
- **Versão de destino:** `1.20.1`
- **Loader:** `forge`
- **Gerado em:** `2026-08-25T18:07:30+00:00`
- **Modo:** somente leitura; nenhum arquivo-fonte foi alterado.

## Contexto detectado

A detecção estática de contexto não foi solicitada.

## Resumo

Foram analisados **3** arquivo(s) Java com **3** regra(s) carregada(s), **1** regra(s) fora do contexto e **3** ocorrência(s).

## Ocorrências

### 1. `flattening-block-ids`

- **Arquivo:** `PortSample.java`
- **Linha/coluna:** `7:36`
- **Severidade:** high
- **Confiança editorial:** 95%
- **Aplicável a:** origem `qualquer`, destino `qualquer`
- **Condição adicional:** `source<1.13 AND target>=1.13`
- **Loader(s):** qualquer
- **Padrão:** `"minecraft:grass"`
- **Correspondência:** `"minecraft:grass"`
- **Código:**

    private final String blockId = "minecraft:grass";
- **Problema:** O ID de bloco grass foi renomeado na Flattening da versão 1.13.
- **Sugestão:** Revisar a migração de grass para grass_block e outras renomeações da mesma leva.
- **Referências:** PLANO_FERRAMENTA_PORTE_MODS.md:41-45

### 2. `commands-literal-wrapper`

- **Arquivo:** `PortSample.java`
- **Linha/coluna:** `10:9`
- **Severidade:** medium
- **Confiança editorial:** 60%
- **Aplicável a:** origem `qualquer`, destino `qualquer`
- **Condição adicional:** `target>=1.19`
- **Loader(s):** forge, neoforge
- **Padrão:** `Commands\.literal\(`
- **Correspondência:** `Commands.literal(`
- **Código:**

    Commands.literal("run");
- **Problema:** O uso de Commands.literal() pode falhar em determinados cenários de mapeamento/reobfuscação.
- **Sugestão:** Revisar o uso direto de com.mojang.brigadier.builder.LiteralArgumentBuilder.literal().
- **Referências:** PLANO_FERRAMENTA_PORTE_MODS.md:32-45

### 3. `flattening-block-ids`

- **Arquivo:** `PortSample.java`
- **Linha/coluna:** `11:9`
- **Severidade:** high
- **Confiança editorial:** 95%
- **Aplicável a:** origem `qualquer`, destino `qualquer`
- **Condição adicional:** `source<1.13 AND target>=1.13`
- **Loader(s):** qualquer
- **Padrão:** `\bBlocks\.grass\b`
- **Correspondência:** `Blocks.grass`
- **Código:**

    Blocks.grass.defaultBlockState();
- **Problema:** O ID de bloco grass foi renomeado na Flattening da versão 1.13.
- **Sugestão:** Revisar a migração de grass para grass_block e outras renomeações da mesma leva.
- **Referências:** PLANO_FERRAMENTA_PORTE_MODS.md:41-45

## Regras não aplicadas por contexto

- `model-event-change` — versão de origem fora do intervalo da regra.

## Limites desta execução

Este relatório faz busca orientada por padrões em fontes Java. Ele não reescreve arquivos, não aplica patches e não substitui a revisão humana. Um achado é um ponto de investigação, não uma prova isolada de incompatibilidade.
