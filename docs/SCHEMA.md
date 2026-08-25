# Schema da base de conhecimento

A base `knowledge-base/rules.yaml` deve conter uma chave raiz `rules` com uma lista de objetos. O scanner valida a estrutura antes de procurar padrões.

| Campo | Tipo | Obrigatório | Finalidade |
|---|---|---:|---|
| `id` | texto | sim | Identificador único da regra |
| `pattern` ou `patterns` | texto ou lista de textos | sim | Expressões regulares a procurar |
| `issue` | texto | não | Explicação do problema |
| `suggestion` | texto | não | Direção para revisão humana |
| `severity` | texto | não | Classificação editorial, como `low`, `medium` ou `high` |
| `confidence` | número entre 0 e 1 | não | Confiança editorial da regra |
| `references` | texto ou lista | não | Origem ou documentação da regra |
| `loader` ou `loaders` | texto ou lista | não | Loaders aos quais a regra se aplica |
| `source_versions` | objeto `min`/`max` ou comparação | não | Intervalo da versão de origem |
| `target_versions` | objeto `min`/`max` ou comparação | não | Intervalo da versão de destino |
| `applies_to` | texto | não | Compatibilidade legada simples, com condições separadas por `AND` |
| `match_in` | `code`, `strings` ou `both` | não | Região lexical onde procurar; padrão: `code` |

## Exemplo

```yaml
rules:
  - id: exemplo-de-api
    pattern: '\bAPI\.antiga\('
    source_versions:
      min: "1.12"
      max: "1.19.4"
    target_versions:
      min: "1.20"
    loader:
      - forge
      - neoforge
    issue: "A API antiga pode ter sido removida no destino."
    suggestion: "Revisar a API equivalente antes de alterar o código."
    severity: high
    confidence: 0.85
    references:
      - "documentacao-interna"
    match_in: code
```

As expressões são aplicadas uma por vez. O scanner preserva arquivo, linha e coluna, mas não edita a fonte. Comentários e strings ficam fora da visão `code`; para IDs escritos como literais, use `strings` ou `both` conscientemente.

Uma regra sem contexto de versão ou loader é considerada aplicável a qualquer contexto. Uma regra com contexto incompatível não gera ocorrência e aparece em uma seção separada do relatório, com a razão da exclusão.
