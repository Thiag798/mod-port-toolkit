# Política de segurança

## Reporte responsável

Não publique credenciais, tokens, chaves privadas ou detalhes exploráveis em issues ou pull requests públicos. Para reportar uma vulnerabilidade, abra uma comunicação privada aos mantenedores do repositório e inclua a versão afetada, o impacto, os passos mínimos de reprodução e uma sugestão de correção quando possível.

## Auditoria automatizada

O workflow de GitHub Actions em [`.github/workflows/security-audit.yml`](.github/workflows/security-audit.yml) executa Gitleaks, Bandit quando aplicável, OpenGrep e o OWASP ZAP Baseline somente quando há um alvo HTTP(S) autorizado configurado. Os relatórios são publicados como artefatos temporários da execução; não devem ser commitados quando contiverem caminhos sensíveis ou evidências confidenciais.

O ZAP Baseline não deve ser habilitado contra sistemas de terceiros ou produção sem autorização formal. A auditoria automatizada é uma camada de detecção e não substitui revisão humana, atualização de dependências, threat modeling ou testes especializados.

O toolkit possui consultas Git explícitas com `shell` desabilitado e argumentos controlados para `diff --name-only`/`diff --name-status`. As anotações locais `# nosec B404/B603` nesses pontos documentam uma exceção revisada, não uma desativação global do Bandit. Os testes CLI possuem a mesma anotação porque invocam somente o scanner local, com `sys.executable`, sem shell e sem entrada de terceiros.

A Fase 5 de build automático permanece excluída: a auditoria não executa Gradle, Java do mod, sandbox de compilação, parser de erros, loop de feedback ou aplicação automática de patches.
