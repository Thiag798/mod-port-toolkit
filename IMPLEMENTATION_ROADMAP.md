# Roadmap de implementação

## Escopo desta versão

Esta versão implementa as propostas de evolução que podem ser executadas de forma local, determinística e revisável: análise híbrida lexical/estrutural de Java, contexto de projeto e dependências, evidências, confiança editorial e de detecção, categorias, regras versionadas, sugestões estruturadas somente informativas, configuração por projeto, suppressions, relatórios avançados, integração Git somente leitura, modo de cobertura, filtros e explicações na extensão VS Code, fixtures positivos/negativos, testes e CI de análise.

## Matriz

| Proposta | Implementação prevista | Estado |
|---|---|---|
| Scanner regex | Mantido como primeira camada para Java e arquivos de configuração | Existente e ampliado |
| AST Java | Estrutural híbrido sem executar build: imports, classes, herança, annotations e chamadas | Implementar |
| Contexto do projeto | Minecraft, loader, Java, mappings, build system, Gradle/Loom/ForgeGradle/NeoGradle e dependências | Implementar |
| Evidências | Evidência lexical, estrutural, contexto, dependência e referência por achado | Implementar |
| Confiança | Editorial, detecção e geral, com cálculo determinístico explicável | Implementar |
| Categorias | API, registry, event, mapping, dependency, Java, Gradle, resource, data, rendering, networking, loader | Implementar |
| Regras versionadas | Regras por salto e schema extensível | Existente e ampliar |
| Transformações | Objetos de sugestão somente informativos; nenhum patch aplicado automaticamente | Implementar |
| Before/after | Exemplos e snippets documentacionais vinculados à regra | Implementar |
| Suppressions | `.mod-port-toolkit.yml` com regra, arquivo, linha e justificativa | Implementar |
| Relatório avançado | Resumo por severidade/categoria, cobertura, contexto, evidências e limitações | Implementar |
| Auditoria | Comando/ação que mostra regras aplicadas, ignoradas e cobertura | Implementar |
| Comparação Git | Diferença de arquivos entre commits/branches, somente leitura | Implementar |
| Cobertura | Métrica da base aplicável por categoria e salto; não é garantia de compatibilidade | Implementar |
| VS Code | Filtros, Problems panel, explicações, comando de cobertura, configuração e suppressions | Implementar |
| CI | Auditoria automática no GitHub Actions por push | Existente e ajustar |
| IA | Preparar contexto controlado, sem chamada automática | Documentar como extensão futura |
| Patches | Preview e geração somente futura; sem escrita automática nesta versão | Fora da implementação ativa |
| Fase 5/build | Loop de compilação, build automático, sandbox de build e parser de erro | Explicitamente excluído |

## Critério de segurança

Nenhum recurso desta versão executa Gradle, Java do mod, scripts do projeto, build, patch, aplicação de alteração ou chamada de IA por padrão. A integração Git apenas consulta metadados e diff. Alterações de configuração feitas por uma ação explícita do usuário devem ser pequenas, visíveis e reversíveis.
