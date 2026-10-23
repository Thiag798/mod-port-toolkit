# Revisão de Código — Mod Port Toolkit

## Resumo

**Intenção revisada:** manter um toolkit estático e somente leitura para apontar incompatibilidades de portabilidade de mods Minecraft entre versões e loaders, com scanner Python, base YAML e extensão VS Code, sem executar builds nem aplicar patches.

A arquitetura está coerente com o escopo: a base de regras é separada do motor, a análise gera evidências revisáveis, a integração Git usa comandos sem shell e a extensão não aplica alterações no código-fonte. Os testes existentes passaram. Entretanto, a revisão encontrou **cinco problemas importantes** que devem ser corrigidos antes de considerar o toolkit robusto para uso em workspaces não confiáveis ou grandes.

**Veredito:** **Solicitar alterações**. Não há um achado crítico que exija interrupção imediata da entrega, mas os itens Major abaixo afetam segurança local, precisão dos diagnósticos e comportamento em projetos reais.

## Conformidade com o escopo

| Requisito | Resultado | Observação |
|---|---|---|
| Análise somente leitura do código-fonte | Conforme | O scanner não aplica patches nem reescreve fontes. |
| Exclusão da Fase 5 | Conforme | Não há execução de Gradle, Minecraft, build automático ou loop de compilação. |
| Escolha de versões e loaders | Conforme | CLI, configuração YAML e QuickPick da extensão cobrem o fluxo. |
| Evidências e sugestões revisáveis | Conforme | Achados incluem regra, linha, severidade, confiança e referências. |
| Compatibilidade de schema Python/TypeScript | Parcial | A validação de configuração foi melhorada, mas ainda há diferenças em suppressions e extensões. |
| Segurança de entradas Git | **Não conforme** | Argumentos de revisão podem ser interpretados como opções do Git. |
| Escalabilidade em workspace | Parcial | O detector Python lê todos os arquivos do projeto, inclusive binários e artefatos não textuais. |

## Problemas Major — corrigir antes de uma próxima versão

### M1. Argumentos de revisão Git podem ser interpretados como opções perigosas

**Arquivos:** `scanner/project.py:402-432` e `vscode-extension/src/analysis.ts:431-432`

`git_changed_files()` acrescenta `revision_range` diretamente à lista de argumentos de `git diff`, e `git_compare()` monta `base..head` a partir de valores fornecidos pelo usuário. O uso de `subprocess.run`/`execFile` sem shell evita shell injection, mas não impede **option injection no próprio Git**.

Um valor iniciado por `--output=...`, por exemplo, pode ser interpretado como opção de saída pelo Git em vez de nome de revisão. Isso cria risco de erro operacional e, dependendo da opção aceita pelo Git e das permissões do processo, de escrita em caminho local escolhido pelo usuário.

**Recomendação:**

- Validar revisões com uma política explícita de caracteres e rejeitar NUL, espaços e opções iniciadas por `-` quando não forem necessárias.
- Usar o suporte de fim de opções do Git quando disponível:

```python
command = [git_executable, "-C", str(root), "diff", "--name-only", "--end-of-options", revision_range]
```

- Para `base` e `head`, validar cada revisão com `git rev-parse --verify` usando os mesmos limites e só depois executar o diff.
- Adicionar testes para entradas como `--output=/tmp/arquivo`, `--exec=...`, `HEAD;touch...` e revisões inválidas.

### M2. Fallback Java perde a correspondência de linhas após comentários multilinha

**Arquivo:** `scanner/java_ast.py:128-148`

O fallback remove comentários com:

```python
clean = re.sub(r"(?s)/\*.*?\*/|//[^\n]*", "", text)
```

Quando um comentário de bloco contém várias linhas, os `\n` são removidos. As posições calculadas por `_line_number(clean, ...)` deixam de corresponder às linhas do arquivo original. O resultado pode exibir uma linha incorreta no diagnóstico e no preview da extensão, exatamente quando o parser estrutural está em modo de recuperação.

**Recomendação:** preservar o comprimento e as quebras de linha, substituindo caracteres de comentário por espaços, mas mantendo `\n`:

```python
def blank_comments(text: str) -> str:
    return re.sub(r"(?s)/\*.*?\*/|//[^\n]*", lambda m: "".join("\n" if c == "\n" else " " for c in m.group()), text)
```

Adicionar fixture com comentário de bloco de 3 ou mais linhas e verificar linha/coluna no fallback.

### M3. Exceções do `javalang` não caem no fallback conservador

**Arquivo:** `scanner/java_ast.py:162-169`

`parse_java()` captura `SyntaxError`, `TypeError` e `ValueError`, mas `javalang` lança `javalang.parser.JavaSyntaxError`, cuja hierarquia é `JavaParserBaseException -> Exception`, não `SyntaxError`. Em Java incompleto, arquivo parcialmente editado ou sintaxe de versão não reconhecida, o scanner pode abortar em vez de usar o fallback que a própria documentação promete.

**Recomendação:** capturar a exceção específica quando `javalang` estiver disponível:

```python
try:
    return _parse_with_javalang(path, text)
except (javalang.parser.JavaParserBaseException, SyntaxError, TypeError, ValueError):
    return _fallback(path, text)
```

Também convém registrar no `JavaStructure` uma indicação de que houve erro de parser, sem expor traceback ao usuário.

### M4. Detector Python percorre e lê arquivos que não participam da análise

**Arquivo:** `scanner/context.py:69-82` e `scanner/context.py:109-112`

`_project_files()` inclui praticamente qualquer arquivo do workspace e `_read_text()` tenta ler até 1 MB de cada um. Isso pode incluir imagens, JARs, caches, `.venv`, diretórios de IDE, relatórios e outros artefatos não textuais. Em um workspace grande, a detecção de contexto pode consumir tempo e memória desnecessários; em repositórios com muitos binários, pode causar uma experiência muito pior que a análise principal.

A implementação TypeScript já é mais restritiva ao usar extensões textuais, portanto há divergência entre os motores.

**Recomendação:**

- Compartilhar uma lista de extensões textuais permitidas entre detector e orquestrador.
- Excluir no mínimo `reports`, `.venv`, `.idea`, `.vscode`, caches e diretórios de dependências.
- Aplicar limite de tamanho e ignorar arquivos cuja extensão não seja suportada.
- Adicionar uma opção de configuração para limites de arquivos/tamanho, mantendo um padrão seguro.

### M5. Suppression por nome simples pode ocultar ocorrências em arquivos diferentes

**Arquivos:** `scanner/project.py:333-317` e `vscode-extension/src/analysis.ts:423` (a função `suppressed` está na linha 423 após a compilação lógica atual)

A condição aceita `finding.path.name` como correspondência. Assim, uma suppression com `file: ContextExample.java` pode ocultar o mesmo `rule` e linha em **qualquer diretório** que contenha esse nome, não apenas no arquivo pretendido. Em workspaces com módulos ou fixtures repetidos, isso pode esconder um problema legítimo.

**Recomendação:**

- Preferir apenas o caminho relativo normalizado ao workspace.
- Se o suporte a basename for necessário por compatibilidade, exigir uma opção explícita como `match: basename` ou emitir aviso no relatório.
- Adicionar teste com `module-a/src/ContextExample.java` e `module-b/src/ContextExample.java`.

## Problemas Minor — recomendados

### m1. Arquivo de suppression pode ficar YAML inválido

**Arquivo:** `vscode-extension/src/extension.ts:158-165`

`addSuppression()` concatena texto ao arquivo existente sem fazer parse nem verificar sua estrutura. Um arquivo válido com `ignore: []`, comentários finais ou outro formato YAML pode receber uma sequência `- rule` em uma posição inválida. Além disso, a edição usa `Number.MAX_SAFE_INTEGER` como fim do range, em vez de usar o documento real.

**Recomendação:** ler e parsear o YAML, atualizar a lista `ignore`, serializar com `js-yaml` e usar o range completo do `TextDocument`.

### m2. A documentação está desatualizada em relação às versões publicadas

**Arquivos:** `README.md:9`, `README.md:132`, `README.md:147`

O README ainda informa `1.3.0-vscode` e menciona o VSIX `1.1.0`, embora a extensão tenha sido atualizada para `1.1.1` e o changelog registre a versão incremental. Isso pode causar instruções de instalação incorretas.

**Recomendação:** derivar a versão da documentação a partir de uma única fonte ou atualizar os exemplos no mesmo commit de versionamento.

### m3. Validação de severidade não é equivalente nos dois motores

**Arquivo:** `scanner/scan.py:273-276`

O parser Python aceita qualquer texto em `severity`, enquanto o TypeScript restringe a `low`, `medium`, `high` e `info`. Uma regra inválida pode ser carregada pelo CLI Python e produzir contagens/limiares inconsistentes.

**Recomendação:** validar a enumeração no `_rule_from_mapping()` e cobrir `severity: critical` com teste de erro.

### m4. `changedFilesOnly` não inclui arquivos não rastreados

**Arquivos:** `scanner/project.py:399-418` e `vscode-extension/src/analysis.ts:431`

A implementação usa `git diff --name-only`, que não inclui arquivos novos ainda não rastreados. O filtro da extensão pode ocultar diagnósticos justamente nos arquivos recém-criados do mod.

**Recomendação:** documentar que o filtro cobre apenas o diff de arquivos rastreados ou combinar com `git status --short`/`git ls-files --others --exclude-standard`, sempre em modo somente leitura.

### m5. Funções públicas e fluxo de análise estão excessivamente comprimidos na extensão

**Arquivo:** `vscode-extension/src/analysis.ts:401-465` e `vscode-extension/src/extension.ts:117-181`

Vários fluxos têm múltiplas operações em uma única linha, especialmente parsing de configuração, varredura e comandos da extensão. Isso dificulta revisão, debugging e cobertura de casos de erro. Não é apenas uma questão estética: facilita que diferenças entre Python e TypeScript permaneçam ocultas.

**Recomendação:** decompor em funções menores (`validateRootConfig`, `scanFile`, `createFinding`, `writeSuppression`, `runAnalysisCommand`) e aplicar um formatter/linter configurado.

## Cobertura de testes

### Pontos positivos

- Existem testes de schema YAML, contexto, loaders, suppressions, confiança, relatório e integridade de fonte.
- Os testes TypeScript exercitam regras reais, análise estrutural, comentários e manifesto.
- O CLI testa o código de saída de `audit` e a geração de `coverage`.

### Lacunas que devem virar testes

1. Java inválido ou incompleto com fallback e preservação de linhas.
2. Comentários multilinha antes de um símbolo detectado.
3. Revisões Git iniciadas por `-`, revisões inválidas e branches com caracteres incomuns.
4. Suppressions com mesmo basename em diretórios diferentes.
5. Arquivos não rastreados no filtro `changedFilesOnly`.
6. Configuração com `severity` inválida e campos desconhecidos no arquivo externo de suppression TypeScript.
7. Arquivo `.gitignore`/workspace grande com binários e diretórios de dependência.
8. Arquivo de suppression existente com `ignore: []`, YAML inválido e comentários.
9. Cancelamento de análise e alteração de arquivos durante uma análise longa na extensão.
10. Invalidação do cache de regras quando conteúdo, tamanho ou timestamp mudam.

## Validações executadas durante a revisão

- `python3 -m unittest discover -s tests`: **19 testes aprovados**.
- `npm --prefix vscode-extension test`: **9 testes aprovados**, incluindo compilação TypeScript.
- `python3 -m compileall -q scanner scripts`: **aprovado**.
- `git diff --check`: **aprovado**.
- Auditoria de dependências local: `js-yaml` não apresenta mais a vulnerabilidade alta direta; permanece 1 vulnerabilidade moderada transitiva em `qs`.

Os scanners externos Gitleaks, Bandit e OpenGrep não estavam instalados no ambiente da revisão; OWASP ZAP não foi executado porque não havia alvo HTTP autorizado. Isso limita a conclusão de segurança automatizada, mas não altera os achados de revisão estática acima.

## Feedback positivo

- A separação entre regras, scanner, contexto, AST, orquestração e extensão é adequada para evolução incremental.
- A política de não executar Gradle/Minecraft e não modificar fontes está claramente refletida no código e na documentação.
- O uso de listas de argumentos com `shell=False` implícito é melhor que interpolação em shell; o problema restante é validação/terminação de opções do Git, não shell injection.
- A extensão fornece evidências, referências, confiança e preview sem apresentar uma falsa promessa de correção automática.
- A configuração rejeita muitos campos desconhecidos e exige justificativa para suppressions, o que favorece revisão humana.

## Perguntas para o mantenedor

1. O filtro `changedFilesOnly` deve incluir arquivos não rastreados ou a intenção é limitar-se ao diff de arquivos já versionados?
2. Basenames em suppressions são uma compatibilidade deliberada ou podem ser removidos em favor de caminhos relativos exatos?
3. A extensão deverá suportar workspaces muito grandes? Em caso afirmativo, limites, cancelamento e processamento incremental devem ser priorizados.
4. O relatório deve permanecer dentro de `reports/` do workspace, mesmo quando o workspace estiver sob controle de um projeto não confiável?
5. O alerta atual do GitHub Dependabot, ainda exibido após a atualização de `js-yaml`, já foi reprocessado ou precisa de investigação no painel de segurança?

## Veredito final

**Request Changes.** Corrigir M1–M5, adicionar os testes correspondentes e atualizar a documentação de versão. Depois disso, repetir a suíte Python/Node, os scanners de segurança disponíveis e uma revisão específica do workflow GitHub Actions.

A revisão não recomenda adicionar build automático, execução de Gradle, patching ou loop de compilação; esses itens continuam corretamente fora do escopo da Fase 5.
