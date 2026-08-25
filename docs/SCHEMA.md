# Schema da base de conhecimento e do projeto

A base em `knowledge-base/rules/` contém arquivos YAML versionados. Cada arquivo pode ter uma lista na raiz ou uma chave raiz `rules`. O scanner Python e a extensão VS Code validam o mesmo contrato conceitual antes de procurar padrões.

## Regras

| Campo | Tipo | Obrigatório | Finalidade |
|---|---|---:|---|
| `id` | texto | sim | Identificador único da regra em toda a base. |
| `pattern` ou `patterns` | texto ou lista de textos | sim | Expressões regulares a procurar. |
| `issue` | texto | não | Explicação do risco observado. |
| `suggestion` | texto | não | Direção para revisão humana. |
| `severity` | `info`, `low`, `medium`, `high` | não | Classificação editorial do achado. |
| `confidence` | número entre `0` e `1` | não | Confiança editorial, não probabilidade estatística. |
| `references` | texto ou lista | não | Fontes oficiais ou referências internas auditáveis. |
| `loader` ou `loaders` | texto ou lista | não | Loaders aos quais a regra se aplica. |
| `source_versions` | objeto `min`/`max` ou comparação | não | Intervalo da versão de origem. |
| `target_versions` | objeto `min`/`max` ou comparação | não | Intervalo da versão de destino. |
| `applies_to` | texto | não | Compatibilidade legada simples, como `source<1.13 AND target>=1.13`. |
| `match_in` | `code`, `strings` ou `both` | não | Região lexical onde procurar; padrão: `code`. |
| `category` | texto | recomendado | Taxonomia, por exemplo `RENDERING`, `ITEMS`, `NETWORKING` ou `BUILD_CONFIG`. |
| `breaking_change` | booleano | recomendado | Indica que a migração pode exigir alteração de API, contrato ou formato. |
| `migration_type` | texto | recomendado | Tipo editorial, por exemplo `api_rename`, `api_redesign`, `resource_path` ou `data_model`. |
| `replacement_api` | texto | recomendado | API, contrato ou formato que deve ser investigado no destino. |
| `affected_packages` | lista de textos | não | Pacotes conhecidos relacionados ao achado. |
| `affected_methods` | lista de textos | não | Métodos conhecidos relacionados ao achado. |
| `affected_classes` | lista de textos | não | Classes ou tipos conhecidos relacionados ao achado. |
| `false_positive_patterns` | lista de regex | não | Padrões na linha que anulam o achado. |
| `requires_ast` | booleano | não | Se verdadeiro, a regra fica inativa quando `analysis.ast` estiver desabilitado. |
| `requires_dependency_check` | booleano | não | Se verdadeiro, a regra fica inativa quando `analysis.dependencies` estiver desabilitado e recebe evidência de dependências quando habilitado. |
| `automatable` | booleano | recomendado | Deve permanecer `false` enquanto não existir revisão/aprovação humana explícita. |
| `automation_safety` | texto | recomendado | Estado de segurança da eventual automação; normalmente `manual_review`. |
| `introduced_in`, `removed_in`, `deprecated_in` | texto | não | Marcos editoriais, quando conhecidos e referenciados. |
| `before`, `after` | texto | não | Exemplos informativos antes/depois; não são patches. |
| `suggestion_object` ou `transformation` | objeto | não | Sugestão estruturada para preview, sempre sem aplicação automática. |

Uma sugestão estruturada usa o seguinte formato:

```yaml
suggestion_object:
  type: replace_method
  old: "Commands.literal"
  new: "LiteralArgumentBuilder.literal"
  automatable: false
  automation_safety: manual_review
```

`old` e `new` descrevem uma possibilidade de revisão. O toolkit não produz arquivo de patch, não edita fontes e não executa transformações.

## Exemplo de regra

```yaml
rules:
  - id: exemplo-de-api
    source_versions:
      min: "1.20"
      max: "1.20.6"
    target_versions:
      min: "1.21"
    loader:
      - forge
      - neoforge
    patterns:
      - "\\bAPI\\.antiga\\("
    category: EXAMPLE
    breaking_change: true
    migration_type: api_rename
    replacement_api: "API.nova"
    requires_ast: true
    automatable: false
    automation_safety: manual_review
    severity: high
    issue: "A API encontrada pode ter mudado no destino."
    suggestion: "Revisar a chamada usando a API da versão alvo."
    confidence: 0.85
    references:
      - "https://example.org/documentation"
    match_in: code
```

As expressões são aplicadas uma por vez. O scanner preserva arquivo, linha e coluna, ignora comentários conforme `match_in` e não edita a fonte. A análise estrutural Java usa `javalang` quando disponível e um fallback lexical conservador quando não está; isso aumenta evidências, mas não transforma o resultado em prova semântica.

Uma regra sem contexto de versão ou loader é considerada aplicável a qualquer contexto. Uma regra incompatível aparece em seção separada do relatório, com a razão da exclusão. A extensão e o scanner calculam confiança de detecção a partir das evidências lexicais, estruturais, editoriais e de dependência; esses valores servem para priorização e revisão, não para aprovação automática.

## Configuração do projeto

O arquivo opcional `.mod-port-toolkit.yml` controla o contexto padrão e a análise:

```yaml
source:
  minecraft: "1.20.1"
  loader: forge
target:
  minecraft: "1.21.1"
  loader: neoforge
analysis:
  ast: true
  dependencies: true
severity:
  fail_on: high
ignore:
  - rule: model-event-change
    file: src/ContextExample.java
    line: 5
    reason: "Revisado e mantido por compatibilidade local"
```

`fail_on` é usado pelo subcomando `audit`: `high` falha somente para achados altos; `medium` falha para médios e altos; `low` inclui baixos; `info` inclui todos. O relatório continua sendo escrito antes do código de saída. A configuração não inicia build nem executa ferramentas do mod.

A extensão registra suppressions via ação explícita com justificativa em `.mod-port-toolkit-ignore.yml`, no formato:

```yaml
ignore:
  - rule: example-rule
    file: src/Example.java
    line: 42
    reason: "Caso analisado manualmente"
```

Suppressions não são silenciosas: aparecem no relatório e só são criadas após ação do usuário. Um `ignore` sem `reason` é inválido.

## Limites de interpretação

As regras representam cobertura conhecida e incremental, não todas as mudanças do Minecraft, dos loaders, mappings ou bibliotecas de terceiros. Ausência de achado não prova compatibilidade. Toda sugestão, inclusive a estruturada, exige revisão humana. A Fase 5 do plano de referência — build automático, execução Gradle/Java, sandbox, parser de erros, loop de feedback e aplicação automática de patches — permanece fora do escopo.
