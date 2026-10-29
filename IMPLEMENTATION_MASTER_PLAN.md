# Mod Port Toolkit — Documento Mestre de Implementação

## Regra operacional nova

Quando o consumo de créditos desta execução atingir ou se aproximar de 40, o trabalho deve parar antes de iniciar uma nova alteração. Nesse ponto, a entrega obrigatória é:

1. o código já implementado e validado;
2. este arquivo Markdown atualizado;
3. a indicação clara do que passou, do que ficou pendente e dos riscos conhecidos.

Não iniciar uma nova etapa de implementação depois desse limite.

## Regras fundamentais permanentes

Estas regras têm precedência sobre qualquer funcionalidade futura:

- O toolkit é somente leitura.
- Nenhum arquivo-fonte do mod pode ser alterado automaticamente.
- Sugestões e previews não aplicam patches.
- A decisão final permanece com o desenvolvedor.
- A Fase 5 está excluída integralmente.
- Não executar `gradlew`, Gradle, Maven, Java do projeto, Minecraft ou qualquer build do mod.
- Não iniciar loop de feedback de compilação.
- Não interpretar logs de build para gerar correções automáticas.
- Não executar o projeto do usuário.
- Consultas Git devem ser somente leitura e devem validar entradas.
- Suppressions exigem justificativa e caminho relativo exato.
- A ausência de achados não prova compatibilidade.
- A base de regras é incremental e deve usar referências e confiança editorial.
- Nenhuma dependência nova deve ser adicionada sem necessidade comprovada.
- Toda lógica com parser, validação, segurança ou ramificação relevante deve receber teste.
- A abordagem Ponytail deve ser aplicada: entender o fluxo existente, reutilizar código, preferir biblioteca padrão, escrever somente o necessário e nunca remover segurança, validação ou tratamento de erro para reduzir linhas.
- Auditorias de segurança devem ser executadas conforme a skill Git Security Audit. Ferramentas ausentes devem ser registradas como ausentes, não instaladas silenciosamente.
- Quando a regra de créditos for atingida, parar e entregar o código e este documento.

## Implementado antes desta etapa

### Núcleo Python

- Scanner de regras YAML versionadas.
- Validação de schema, IDs duplicados, regex e severidade.
- Filtragem por Minecraft de origem, Minecraft de destino e loader.
- Detecção estática de Java, loader, mappings, dependências e metadados.
- Parser Java híbrido com `javalang` e fallback conservador.
- Preservação de linhas e colunas no fallback após comentários multilinha.
- Captura de exceções específicas do parser Java.
- Evidências, confiança editorial e confiança da detecção.
- Suppressions com justificativa e caminho relativo exato.
- Cache de regex e offsets de linha.
- Consultas Git sem shell, com validação contra option injection.
- Comandos `audit`, `coverage` e `compare`.
- Código de saída configurável por `severity.fail_on`.

### Extensão VS Code

- Seleção interativa de versões e loaders.
- Diagnósticos no painel Problems.
- Relatório Markdown.
- Cobertura da base.
- Comparação de commits.
- Preview de sugestões sem alterações.
- Suppression estruturada em YAML.
- Filtros por severidade, breaking change e arquivos alterados.
- Inclusão de arquivos não rastreados no filtro padrão de alterações.
- Cache de regras e regex durante a sessão.
- Testes de manifesto, schema, contexto, comentários e cobertura.

### Segurança e documentação

- Workflow GitHub Actions para testes e auditoria.
- Política de execução somente leitura.
- Documentação de instalação, schema, escopo e Fase 5 excluída.
- Auditoria local executada com status explícito para Gitleaks, Bandit, OpenGrep e ZAP.
- Relatório de revisão completa em `CODE_REVIEW_2026-09-19.md`.
- Dependência direta `js-yaml` atualizada; vulnerabilidades transitivas permanecem registradas.

## Implementado nesta etapa 1.4

### Relatórios para automação

O comando `audit` passou a aceitar:

```bash
python3 scanner/scan.py audit --project . --format markdown
python3 scanner/scan.py audit --project . --format json
python3 scanner/scan.py audit --project . --format sarif
```

O JSON possui schema identificável, contexto de somente leitura, indicação explícita de que a Fase 5 está excluída, findings, severidade, categoria, confiança, evidências e referências. O SARIF é compatível com consumidores que aceitam SARIF 2.1.0 e contém localização, regra, nível e mensagem.

### Limites de workspace

A configuração agora suporta:

```yaml
analysis:
  max_file_size: 1000000
  max_files: 10000
```

O limite de tamanho evita leitura de arquivos textuais excessivamente grandes. O limite de quantidade evita que um workspace muito grande consuma recursos sem controle. Os padrões conservadores são 1 MB por arquivo e 10.000 arquivos.

### Testes adicionados

- Preservação de linha após comentário Java multilinha.
- Rejeição de option injection em revisões Git.
- Rejeição de severidade inválida.
- Estrutura dos relatórios JSON e SARIF.
- Aplicação do limite máximo de arquivos.

## Próximas implementações planejadas

### 1.4.x — finalizar a fundação

- Adicionar no relatório a contagem de arquivos ignorados por tamanho e por limite.
- Tratar permissões e mudanças durante a enumeração sem abortar o workspace inteiro.
- Adicionar teste de caminho duplicado em suppressions.
- Validar SARIF contra um schema externo quando essa ferramenta estiver disponível.
- Alinhar a exportação JSON entre Python e TypeScript.
- Atualizar o VS Code para oferecer escolha de formato de relatório.

### 1.5 — análise incremental e experiência VS Code

Implementado nesta etapa: cancelamento real com `CancellationToken`, preservação dos diagnósticos anteriores ao cancelar, reanálise opcional somente dos arquivos alterados, cache persistente no armazenamento global da extensão invalidado por configuração, mtime, tamanho e assinatura da base, view dedicada com resumo por severidade, categoria, confiança e regras aplicáveis, e mensagens de progresso por arquivo.

Pendente para a próxima tranche: ações específicas de abrir referência e evidência na view, merge de diagnósticos antigos quando o modo incremental estiver ativo, hash de conteúdo opcional para detectar alterações com mtime preservado e controles visuais para ativar o modo incremental.

### 1.6 — qualidade da base de regras

Implementado nesta etapa: comando `rule-coverage` com schema JSON próprio, validação dos metadados editoriais, identificação de fixtures positivos e negativos convencionados, executor `rule-tests` com manifesto YAML e contratos de achados, seis fixtures representativos para três regras, validações contra traversal, symlinks, arquivos grandes e número excessivo de casos, indicação explícita de somente leitura e exclusão da Fase 5, além da análise documentada do ODT em `ODT_ANALYSIS_2026-10-26.md`.

Resultado atual: 26 regras carregadas, 26 com metadados completos, 3 fixtures positivos e 3 negativos, com 6/6 contratos estáticos aprovados. As 23 regras restantes ainda não possuem fixtures; essa lacuna foi reportada honestamente e não foram fabricados testes apenas para elevar a métrica.

Pendente: fixtures positivos e negativos para cada regra, casos específicos para comentários, strings, loader e intervalo de versões, catálogo de referências oficiais, comparação de regras entre saltos e relatório de paridade entre os motores.

### 1.7 — relatórios e integração

- Checklist Markdown de migração.
- Exportação de resumo por arquivo.
- Exportação SARIF com regras declaradas no bloco `tool.driver.rules`.
- Integração opcional com GitHub Code Scanning somente como saída estática.
- Nenhuma integração pode iniciar build ou alterar o repositório do mod.

### Segurança e manutenção contínuas

- Atualizar dependências transitivas quando houver versão compatível.
- Reexecutar `npm audit` após cada atualização de dependência.
- Executar Gitleaks, Bandit e OpenGrep quando os binários estiverem disponíveis.
- Executar ZAP somente com URL HTTP(S) e autorização explícita.
- Revisar option injection, path traversal, YAML, symlinks e arquivos gigantes em cada alteração.
- Manter o workflow de segurança sem segredos nos relatórios publicados.

## Critérios de aceite para toda implementação futura

Uma funcionalidade só está concluída quando:

- possui documentação em português;
- possui teste automatizado proporcional ao risco;
- mantém a análise somente leitura;
- não executa build nem ferramenta do mod;
- não remove validação ou tratamento de erro;
- preserva paridade entre CLI e extensão quando a funcionalidade existir nos dois lados;
- passa a suíte Python;
- passa a suíte Node/TypeScript;
- passa `git diff --check`;
- passa a auditoria de segurança disponível no ambiente;
- registra limitações e ferramentas ausentes;
- atualiza este documento.

## Estado no momento desta entrega

A etapa 1.6 foi implementada parcialmente e validada com 28 testes Python, 11 testes Node/TypeScript, compilação TypeScript, `compileall`, `git diff --check`, execução real do `rule-coverage` e `rule-tests` com 6/6 contratos aprovados, e auditoria de segurança local. O relatório encontrou 26 regras com metadados completos, 3 fixtures positivos e 3 negativos; as 23 regras restantes ainda precisam de fixtures. O ODT analisado está resumido em `ODT_ANALYSIS_2026-10-26.md`.

O `npm audit` local reportou 7 vulnerabilidades transitivas: 6 altas e 1 moderada. Nenhuma atualização automática foi aplicada. Gitleaks, Bandit e OpenGrep estavam ausentes no ambiente; ZAP foi pulado por não existir alvo HTTP autorizado.

O limite de créditos é uma regra de parada: caso seja alcançado antes da conclusão de alguma etapa, a etapa deve ser marcada como pendente neste arquivo, sem tentar contorná-lo com execução adicional.

A Fase 5 continua excluída e não será implementada.
