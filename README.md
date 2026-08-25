# Mod Port Toolkit

Ferramenta de apoio à **migração e revisão de compatibilidade de mods do Minecraft Java** entre versões e mod loaders. O projeto combina um scanner Python, uma base de conhecimento versionada em YAML e uma extensão do Visual Studio Code que apresenta os achados diretamente no painel **Problems**.

> O Mod Port Toolkit é um copiloto de análise estática. Ele aponta evidências e sugere pontos de revisão; a decisão final e qualquer alteração no código permanecem sob controle do desenvolvedor.

## Estado do projeto

A versão atual é `1.3.0-vscode`. O scanner Python e o motor TypeScript da extensão usam o mesmo contrato de regras: padrões, contexto de versão, loader, severidade, categorias, confiança, evidências, referências e modo de busca. A base inclui saltos históricos e recentes, mas sua cobertura é incremental e não deve ser interpretada como uma garantia de compatibilidade total.

| Componente | Estado | Objetivo |
|---|---:|---|
| Scanner Python | Disponível | Varredura somente leitura e geração de relatório Markdown. |
| Base YAML versionada | Disponível | Registrar mudanças por salto de Minecraft e loader. |
| Detecção de contexto | Disponível | Identificar estaticamente Java, loader, mappings e algumas dependências. |
| Extensão VS Code | Disponível | Escolher origem/destino, exibir diagnósticos e abrir relatório. |
| Exemplos e fixtures | Disponível | Documentar casos e proteger o comportamento com testes. |
| AST Java híbrido | Disponível | Símbolos estruturais com `javalang` e fallback conservador, sem execução do projeto. |
| Evidências, confiança e cobertura | Disponível | Explicar a origem de cada achado e o alcance conhecido das regras aplicáveis. |
| Configuração e suppressions | Disponível | Controlar contexto, AST/dependências e registrar exceções com justificativa. |
| Patches automáticos | Fora do escopo atual | O projeto apenas sugere revisão; não altera fontes. |
| Build automático e loop de compilação | **Excluído** | A Fase 5 do plano anexado não é implementada nem executada. |

## O que o projeto faz

O toolkit lê arquivos de código e configuração, identifica padrões associados a mudanças conhecidas, filtra as regras conforme as versões e loaders escolhidos, localiza cada ocorrência com linha e coluna e produz uma explicação com severidade, confiança, sugestão e referência. O scanner também informa quais regras foram descartadas por não serem aplicáveis ao contexto selecionado.

A extensão do VS Code oferece o mesmo fluxo de forma interativa. O desenvolvedor abre a pasta do mod, escolhe a versão de origem, a versão de destino, o loader de origem e o loader de destino e executa a análise. Os problemas são publicados no Problems panel e um relatório é salvo dentro de `reports/`.

## O que o projeto não faz

O toolkit não compila o mod, não executa `gradlew`, não inicia Minecraft, não aplica patches, não modifica arquivos de origem, não tenta corrigir erros automaticamente e não transforma logs de compilação em novas regras. A **Fase 5 — Loop de Feedback de Compilação** do plano de referência foi excluída integralmente por decisão de escopo.

A ausência de um achado não prova que o mod é compatível. Um padrão pode estar fora da base, ser usado por reflexão, depender de uma API externa ou exigir análise semântica. Por isso, cada resultado deve ser tratado como evidência para revisão humana, e não como diagnóstico definitivo isolado.

## Arquitetura

A organização separa a base de regras, a análise, os artefatos de exemplo, os relatórios e a extensão do editor. A extensão empacota uma cópia da base para funcionar em qualquer workspace; a base principal do repositório permanece como fonte editorial para novas regras.

```text
mod-port-toolkit/
├── knowledge-base/
│   └── rules/                  # Regras por salto e regras comuns
├── scanner/
│   ├── scan.py                 # Scanner, CLI legado e subcomandos audit/coverage/compare
│   ├── context.py              # Detecção estática de contexto
│   ├── java_ast.py             # Parser Java híbrido somente leitura
│   ├── project.py              # Orquestração de workspace, config e relatório
│   └── __init__.py
├── vscode-extension/
│   ├── src/
│   │   ├── analysis.ts         # Motor TypeScript da extensão
│   │   └── extension.ts        # Comandos, QuickPick e Problems panel
│   ├── knowledge-base/rules/   # Cópia empacotada da base
│   ├── test/                   # Testes do motor compilado
│   └── package.json
├── docs/                       # Documentação complementar
├── examples/                   # Casos before/after documentacionais
├── reports/                    # Relatórios de exemplo ou gerados
├── tests/                      # Fixtures e testes Python
├── CHANGELOG.md
├── PLAN_COMPARACAO_SEM_FASE5.md
├── research_sources_notes.md
├── requirements.txt
└── README.md
```

## Instalação do scanner Python

O scanner requer Python 3.10 ou superior e PyYAML. Em um ambiente local, recomenda-se usar um ambiente virtual para não misturar dependências do projeto com o sistema:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
```

A base padrão é carregada da pasta `knowledge-base/rules/`. Também é possível informar um arquivo YAML individual com `--rules`, o que facilita testar uma regra isoladamente. O parser estrutural usa `javalang==0.13.0` quando instalado e fallback regex conservador quando não estiver; nenhum processo do mod é executado.

## Uso do scanner

### Modo legado Java-only

A execução a partir da raiz do projeto segue este formato:

```bash
python3 scanner/scan.py \
  --source /caminho/para/o/mod \
  --source-version 1.20.1 \
  --target-version 1.21.1 \
  --loader neoforge \
  --detect-context \
  --output reports/meu-mod.md \
  --mod-name MeuMod
```

O parâmetro `--source` aceita um arquivo Java ou uma pasta. Quando recebe uma pasta, o scanner percorre os arquivos Java recursivamente. A opção `--detect-context` acrescenta ao relatório informações encontradas estaticamente em arquivos do projeto, sem executar processos externos.

### Auditoria de workspace

Para analisar código Java, recursos e arquivos de configuração em conjunto, use a configuração opcional `.mod-port-toolkit.yml` e os subcomandos de projeto:

```bash
python3 scanner/scan.py audit --project /caminho/para/o/mod \
  --rules knowledge-base/rules \
  --output reports/mod-port-report.md
python3 scanner/scan.py coverage --project /caminho/para/o/mod \
  --rules knowledge-base/rules \
  --output reports/coverage.json
python3 scanner/scan.py compare --project /caminho/para/o/mod \
  --base HEAD~1 --head HEAD \
  --output reports/git-compare.md
```

`audit` produz evidências, confiança, categorias, regras descartadas por contexto e suppressions. `coverage` informa a proporção de regras carregadas que são aplicáveis ao contexto — não a compatibilidade do mod. `compare` lista alterações Git com `diff --name-status`, sem alterar branch, índice ou arquivos. O `audit` retorna código 1 segundo `severity.fail_on` quando há achado naquele nível ou acima, mas ainda grava o relatório.

| Parâmetro | Obrigatório | Descrição |
|---|---:|---|
| `--source` | Sim | Arquivo Java ou diretório do mod a ser analisado. |
| `--rules` | Não | YAML ou pasta alternativa de regras; o padrão é `knowledge-base/rules/`. |
| `--source-version` | Não | Versão de origem usada para aplicar intervalos de regra. |
| `--target-version` | Sim | Versão de destino usada para aplicar intervalos de regra. |
| `--loader` | Não | Loader usado para filtrar regras: `forge`, `neoforge`, `fabric` ou `quilt`. |
| `--detect-context` | Não | Executa detecção estática de contexto e inclui o resultado no relatório. |
| `--output` | Não | Caminho do relatório Markdown. |
| `--mod-name` | Não | Nome exibido no título do relatório. |

Os subcomandos `audit`, `coverage` e `compare` aceitam `--project`, `--config`, `--rules`, `--output` e, quando aplicável, parâmetros de diff. Veja o contrato completo em [`docs/SCHEMA.md`](docs/SCHEMA.md).

## Extensão do VS Code

A extensão fica em `vscode-extension/` e pode ser instalada pelo arquivo `mod-port-toolkit-vscode-1.1.0.vsix`. Ela não precisa ser publicada no Marketplace para uso local; a publicação oficial continua sendo uma etapa manual, dependente de publisher e autorização do mantenedor.

Para preparar ou testar a extensão a partir do código-fonte:

```bash
cd vscode-extension
npm install
npm test
npm run compile
npm run package
```

O comando `npm run package` gera um VSIX local. No VS Code, abra a view **Extensions**, selecione **Views and More Actions… → Install from VSIX…** e escolha o arquivo gerado. Alternativamente, em uma instalação que disponha do comando `code`, use:

```bash
code --install-extension /caminho/completo/mod-port-toolkit-vscode-1.1.0.vsix
```

Depois de abrir a pasta raiz do mod, execute um dos comandos na Command Palette:

| Comando | Resultado |
|---|---|
| `Mod Port Toolkit: Analisar portabilidade` | Solicita origem, destino e loaders; analisa o workspace e publica problemas. |
| `Mod Port Toolkit: Executar auditoria` | Analisa o workspace usando a configuração atual e grava o relatório. |
| `Mod Port Toolkit: Configurar versões e loaders` | Salva a seleção no workspace sem executar a análise. |
| `Mod Port Toolkit: Ver cobertura da base` | Abre `reports/coverage.json` com o alcance conhecido das regras. |
| `Mod Port Toolkit: Comparar commits Git` | Lista status entre dois commits/branches em modo somente leitura. |
| `Mod Port Toolkit: Visualizar sugestão sem alterar arquivos` | Mostra before/after e segurança de uma sugestão estruturada, sem editar fontes. |

A lista contém versões conhecidas e a opção **Outra versão…**, que permite informar uma versão manualmente. Os diagnósticos incluem arquivo, linha, coluna, severidade, identificador, categoria, confiança, evidências e referências. Filtros opcionais permitem severidade mínima, breaking changes e arquivos alterados. A ação de suppression exige justificativa e registra `.mod-port-toolkit-ignore.yml`; não existe Quick Fix que altere código-fonte. O relatório detalhado é salvo em `reports/`.

As configurações também podem ser escritas em `.vscode/settings.json`:

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

## Base de conhecimento

As regras estão separadas por salto para evitar um arquivo monolítico. A organização atual cobre mudanças relevantes documentadas em primers oficiais do NeoForge, mudanças recentes do Fabric e compatibilidade direcional Quilt/Fabric. Os primers do NeoForge se apresentam como visões de alto nível e não exaustivas; por isso, novas regras devem sempre incluir referência e confiança editorial [1] [2].

| Arquivo | Cobertura principal |
|---|---|
| `common.yaml` | Regras que podem aparecer em mais de um salto, como eventos/modelos. |
| `1.12_to_1.13.yaml` | Flattening, IDs, recursos, idiomas, datapacks e Brigadier. |
| `1.16_to_1.17.yaml` | BlockEntity, Java 16, capabilities, ToolActions e mappings Forge. |
| `1.20_to_1.20.5.yaml` | Java 21, metadata NeoForge e Data Components. |
| `1.20_to_1.21.yaml` | ResourceLocation, pastas singulares, rendering, GUI, receitas, portais e jukebox. |
| `neoforge_21.yaml` | Eventos, networking, capabilities, PlantType e ItemAbilities do NeoForge. |
| `1.21_to_26.1.yaml` | Transição Fabric de Yarn/Intermediary para Mojang Mappings. |

### Schema mínimo

Cada YAML contém uma chave raiz `rules` com uma lista de objetos. O identificador e pelo menos um padrão são obrigatórios:

```yaml
rules:
  - id: example-rule
    source_versions:
      min: "1.20"
      max: "1.20.6"
    target_versions:
      min: "1.21"
    loader:
      - forge
      - neoforge
    patterns:
      - "\\bExampleApi\\b"
    severity: high
    issue: "A API encontrada mudou no destino."
    suggestion: "Revisar a chamada usando a API da versão alvo."
    confidence: 0.85
    references:
      - "https://example.org/documentation"
    match_in: code
```

| Campo | Tipo | Função |
|---|---|---|
| `id` | Texto | Identificador único da regra. |
| `pattern`/`patterns` | Texto/lista | Expressões regulares procuradas. |
| `source_versions` | Objeto | Intervalo opcional de versões de origem. |
| `target_versions` | Objeto | Intervalo opcional de versões de destino. |
| `loader`/`loaders` | Texto/lista | Loaders em que a regra é relevante. |
| `applies_to` | Texto | Condição legada, como `source<1.13 AND target>=1.13`. |
| `severity` | `low`, `medium`, `high`, `info` | Peso visual e técnico do achado. |
| `confidence` | Número de `0` a `1` | Confiança editorial, não probabilidade estatística. |
| `references` | Lista | Fontes ou referências internas para revisão. |
| `match_in` | `code`, `strings` ou `both` | Região lexical em que o padrão deve ser procurado. |
| `category` | texto | Taxonomia do achado. |
| `breaking_change` | booleano | Marca risco de quebra de contrato/API/formato. |
| `migration_type` | texto | Tipo editorial da migração. |
| `replacement_api` | texto | API, contrato ou formato para revisão. |
| `affected_*` | listas de textos | Pacotes, métodos e classes relacionados. |
| `requires_ast` | booleano | Desabilita a regra quando AST estiver desligada. |
| `requires_dependency_check` | booleano | Controla verificação e evidência de dependências. |
| `automatable`, `automation_safety` | booleano/texto | Governança; o padrão efetivo é revisão manual. |
| `before`, `after`, `suggestion_object` | textos/objeto | Preview informativo sem aplicação de patch. |

O modo `code` ignora comentários e literais; `strings` procura dentro de strings e ignora comentários; `both` considera as duas regiões. A preservação de quebras de linha permite apontar linha e coluna sem reescrever o arquivo.

A documentação detalhada do schema está em [`docs/SCHEMA.md`](docs/SCHEMA.md). O processo de comparação com o plano original está em [`PLAN_COMPARACAO_SEM_FASE5.md`](PLAN_COMPARACAO_SEM_FASE5.md).

## Pesquisa incorporada

A base foi alimentada por referências oficiais e notas auditáveis em [`research_sources_notes.md`](research_sources_notes.md). Entre os fatos usados estão a exigência de Java 21 a partir do Minecraft 1.20.5 [3], mudanças de API vanilla documentadas no primer 1.20.6→1.21 [4], alterações específicas do NeoForge [5], a compatibilidade direcional Quilt/Fabric [6] e a migração de Yarn para Mojang Mappings a partir do Minecraft 26.1 [7].

A pesquisa é organizada por saltos. Isso é mais seguro do que afirmar que uma única regra representa todas as versões intermediárias, todos os mappings, todos os loaders e todas as bibliotecas de terceiros. Cada nova regra deve informar o salto, o loader, a fonte, a confiança e um exemplo de teste positivo ou negativo.

## Testes e validação

O scanner Python possui uma suíte `unittest` que cobre parsing YAML, regras versionadas, contexto, loaders, regex, filtragem lexical, entrada inválida, recursão, AST híbrido, configuração, suppressions, limiar `fail_on`, cobertura e integridade somente leitura:

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
```

A extensão possui testes Node para carregamento da base, integração com o fixture NeoForge, detecção de Java, cobertura, prevenção de falsos positivos em comentários e integridade do manifesto/`.vscodeignore`:

```bash
cd vscode-extension
npm test
```

A validação de desenvolvimento contém **19 testes Python aprovados** e **9 testes Node aprovados**, além de compilação TypeScript e teste de manifesto. O VSIX deve ser gerado localmente com `npm run package` e inspecionado como arquivo instalável; não há publicação automática no Marketplace.

## Auditoria de segurança no GitHub Actions

O arquivo [`.github/workflows/security-audit.yml`](.github/workflows/security-audit.yml) executa a auditoria a cada `push` em qualquer branch e também pode ser iniciado manualmente. O workflow usa permissões mínimas de leitura, preserva os relatórios como artefatos da execução por 14 dias e grava um resumo no painel da execução.

O workflow executa Gitleaks, Bandit quando há arquivos Python e OpenGrep. O OWASP ZAP Baseline fica desativado por padrão, porque precisa de uma aplicação HTTP(S) em execução e de um alvo autorizado. Para habilitá-lo, configure a variável de repositório `ZAP_TARGET_URL` com uma URL sob seu controle e a variável `ZAP_AUTHORIZED` com o valor literal `true`. Não configure terceiros ou produção sem autorização formal.

O workflow fixa a versão do Bandit e do OpenGrep para tornar o resultado reproduzível. Como ferramentas externas podem atualizar regras e formatos, revise as versões antes de alterar o ambiente de CI. Um retorno não zero pode representar achados; os relatórios JSON, SARIF, HTML e Markdown devem ser revisados no artefato da execução.

## Como adicionar uma regra

Uma regra nova deve ser criada no arquivo YAML correspondente ao salto, evitando alterar `common.yaml` quando a mudança for específica de uma versão ou loader. O autor deve escolher um identificador estável, registrar fonte verificável, explicar o problema, escrever uma sugestão de revisão, definir severidade e confiança e selecionar conscientemente `match_in`.

Depois da alteração, execute as duas suítes de teste. Inclua um caso positivo e, quando possível, um caso negativo que demonstre que comentários, strings irrelevantes ou contexto incompatível não geram um diagnóstico indevido. A regra deve permanecer somente analítica; qualquer correção precisa ser revisada e aplicada pelo desenvolvedor.

## Licença e contribuição

O toolkit e a extensão são distribuídos sob a licença MIT. Contribuições são bem-vindas quando preservam o princípio de revisão humana, não introduzem execução automática de build e incluem documentação, referência e testes para novas regras.

## Referências

[1]: https://docs.neoforged.net/primer/docs/ "NeoForge Migration Primers"

[2]: https://docs.neoforged.net/primer/docs/1.14/ "NeoForge — 1.12 → 1.13/1.14 Mod Migration Primer"

[3]: https://www.minecraft.net/en-us/article/minecraft-java-edition-1-20-5 "Minecraft Java Edition 1.20.5"

[4]: https://docs.neoforged.net/primer/docs/1.21/ "NeoForge — 1.20.6 → 1.21 Mod Migration Primer"

[5]: https://docs.neoforged.net/primer/docs/1.20.5/neo/ "NeoForge — Neo Changes for 1.20.5"

[6]: https://quiltmc.org/en/about/faq/ "QuiltMC FAQ"

[7]: https://docs.fabricmc.net/develop/porting/mappings/ "Fabric Documentation — Migrating Mappings"

[8]: https://code.visualstudio.com/api/references/vscode-api "VS Code API Reference"

[9]: https://code.visualstudio.com/api/working-with-extensions/publishing-extension "VS Code — Publishing Extensions"
