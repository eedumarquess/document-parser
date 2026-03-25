# Parser documental — requisitos fechados

## Objetivo de negócio

**Qual problema esse primeiro parser resolve no dia 1?**  
R: Resolve operação manual que precisa passar na mão as informações do laudo para um sistema.  
J: O sistema será desenhado para substituir a digitação manual de informações do laudo por um pipeline automatizado de ingestão, processamento e retorno estruturado. Portanto, o objetivo primário do MVP não é apenas “ler documentos”, mas reduzir esforço operacional e criar uma base técnica sólida para automação de cadastro e evolução futura.

**É só transcrição bruta do documento inteiro, ou esse texto já precisa vir “limpo” para consumo posterior?**  
R: Precisa vir "limpo" para consumo posterior, penso em um JSON com objetos de campos, vindo a pontuação e o que foi extraido.  
J: O contrato canônico do sistema será um JSON estruturado, e não texto puro. O retorno deverá conter pelo menos: texto consolidado normalizado, objetos de campos identificados, marcações de checkbox, trechos manuscritos, trechos ilegíveis e score de confiança. O texto continuará existindo como artefato do processamento, mas a forma oficial de integração será orientada a objetos e metadados.

**Quem vai consumir a saída: humano, outro sistema, pipeline de extração, busca, auditoria?**  
R: Por agora ninguem vai consumir, é um projeto interno que não pretendo vender ou fazer algo, apenas para ter no meu portfolio.  
J: Como não existe consumidor externo imediato, o sistema pode privilegiar clareza arquitetural, versionamento, rastreabilidade, observabilidade e qualidade técnica desde o início. Ainda assim, o contrato será desenhado com padrão produtizável, para evitar retrabalho caso surja um consumidor real depois.

**O sucesso do MVP será medido por quê: taxa de documentos processados, legibilidade do texto, cobertura de manuscrito, tempo de resposta, custo por documento?**  
R: Taxa de documentos processados, legibilidade do texto, cobertura de manuscrito, tempo de resposta.  
J: Os KPIs principais do MVP serão operacionais e de qualidade: taxa de sucesso por documento, legibilidade do texto final, cobertura de manuscrito e latência fim a fim. Custo por documento será monitorado, mas não será critério primário de aceitação nesta fase.

## Escopo do MVP

**No MVP, você quer suportar só essa ficha clínica ou qualquer PDF/imagem?**  
R: No momento só ficha clinica, mas no futuro podemos colocar mais tipos de arquivos.  
J: O MVP será escopado para ficha clínica, com tuning, testes e validações pensados para esse tipo documental. A arquitetura, porém, nascerá extensível para novos domínios documentais, evitando acoplamento estrutural ao contexto clínico.

**Vai aceitar apenas PDF ou também JPG/PNG?**  
R: Ambos os arquivos.  
J: O módulo de ingestão aceitará PDF, JPG e PNG. Internamente, todos os formatos serão normalizados para uma representação comum por página, de modo que o restante do pipeline não dependa do tipo de entrada original.

**Documento entra por upload multipart, URL, base64, storage key, ou mais de um formato?**  
R: upload multipart por agora, URL e storage key no futuro.  
J: O adapter HTTP inicial aceitará `multipart/form-data`. A camada de aplicação será desacoplada por uma porta de origem do documento, permitindo adicionar URL e storage key depois sem quebrar o domínio nem o contrato central.

**O retorno será síncrono na mesma requisição ou assíncrono com job/status?**  
R: assincrono com job/status, podemos usar rabbitmq ou kafka, fica ao seu critério.  
J: O sistema adotará processamento assíncrono com criação de job e consulta posterior de status. Para o MVP, RabbitMQ é a escolha mais coerente, porque o cenário é de comando assíncrono com volume moderado, necessidade de DLQ e operação mais simples que Kafka. Kafka faria mais sentido se o ecossistema evoluísse para múltiplos consumidores, replay massivo e fluxo de eventos mais amplo.

**Quando o documento tiver várias páginas, você quer um texto único concatenado ou texto por página?**  
R: texto unico, de preferencia.  
J: O resultado externo padrão será um texto único concatenado. Mesmo assim, o sistema manterá metadados por página internamente para debug, auditoria, comparações, reprocessamento e evolução futura do parsing.

**Você quer manter layout lógico mínimo, por exemplo separando páginas e blocos, ou basta texto corrido?**  
R: usar o texto corrido.  
J: A saída normalizada será texto corrido, sem compromisso com preservação espacial fina. A semântica relevante será preservada por marcações estruturais e metadados, não por posição visual ou blocagem rígida.

## Definição da saída

**O “texto de saída” deve preservar quebras de linha, ordem visual dos blocos, indicação de página, caixas marcadas/não marcadas, campos vazios, trechos ilegíveis?**  
R: Sim, deve preservar tudo menos: quebras de linha, ordem visual dos blocos, indicação de página.  
J: A preservação será semântica, não visual. O sistema manterá no resultado checkbox marcado ou não marcado, indicação de campos vazios e marcador explícito de ilegibilidade, mas removerá a dependência de quebras de linha, ordenação espacial rígida e separação por página. Isso favorece consumo programático posterior.

**Exemplo: quando houver checkbox, você quer que o texto venha como “Não pratico [marcado]” ou simplesmente “Não pratico”?**  
R: Implícito na resposta acima.  
J: O texto consolidado deverá carregar a semântica da marcação. Logo, o comportamento esperado é algo equivalente a `Não pratico [marcado]` ou uma representação estruturada equivalente dentro do JSON. Não será suficiente devolver apenas o rótulo sem a informação de estado.

**Quando houver manuscrito ilegível, quer retornar marcador como [ilegível], [baixa_confianca] ou omitir?**  
R: [ilegível].  
J: O parser nunca deverá omitir silenciosamente um manuscrito não lido. O comportamento padrão será retornar o marcador explícito `[ilegível]`, preservando o fato de que havia conteúdo manuscrito sem transcrição confiável.

**Quer idioma fixo em pt-BR ou auto-detecção?**  
R: Crie um módulo focado em pt-BR mas que no futuro pode passar para auto-detecção.  
J: O pipeline inicial será otimizado para pt-BR, inclusive em normalização textual, heurísticas, prompts e validações. A auto-detecção de idioma ficará prevista como capacidade futura encapsulada em componente próprio, sem contaminar a simplicidade do MVP.

## Evolução futura já prevista

**Depois do texto bruto, o próximo passo será: extração estruturada por campos, classificação de template, detecção de checkbox, leitura de manuscrito, normalização semântica, ou todos?**  
R: 1. extração estruturada por campos 2. detecção de checkbox 3. leitura de manuscrito 4. normalização semântica 5. classificação de template (só existirá um template por agora).  
J: A esteira será pensada desde o início como pipeline de enriquecimento progressivo. Mesmo no MVP, a estrutura interna deverá permitir capacidades separadas e evolutivas: OCR ou base text, checkbox parsing, manuscrito, normalização semântica e, mais adiante, classificação e uso explícito de templates.

**Você já quer que o domínio nasça preparado para múltiplos “modos de processamento”, por exemplo: raw_text, structured_extraction, template_detection, validation?**  
R: claro, já nasça assim.  
J: O domínio será orientado a capacidades de processamento, e não a um fluxo único rígido. Isso significa que um `ProcessingJob` deverá declarar modo, versão de pipeline e artefatos produzidos, permitindo reuso do mesmo backbone para futuras modalidades.

## Domínio e DDD

**Qual é o bounded context principal? “Document Parsing” apenas, ou algo maior como “Clinical Intake”?**  
R: Document Parsing, a ideia futura é usar os mesmos módulos para crescer a aplicação, tendo um dominio para cada documento.  
J: O bounded context principal será `Document Parsing`. O contexto clínico entra como especialização documental e conjunto de heurísticas, não como domínio raiz. Isso evita contaminar a plataforma com regras específicas de um único tipo documental.

**Você quer separar desde já contextos como Ingestion, Document Processing, OCR/LLM Extraction, Template Management, Result Delivery, Audit/Observability?**  
R: Perfeito, pode ser todos esses.  
J: Esses subdomínios serão separados desde o desenho inicial. Nem todos precisam virar serviços independentes no MVP, mas deverão existir como fronteiras explícitas de responsabilidade e contrato.

**O documento processado é uma entidade do domínio com ciclo de vida próprio?**  
R: Sim, ele é.  
J: `Document` e `ProcessingJob` terão ciclo de vida explícito, com estados observáveis como recebido, validado, armazenado, deduplicado, enfileirado, processando, processado, parcial, falho e reprocessado.

**Você quer versionar o resultado de processamento?**  
R: Quero versionar sim.  
J: Cada resultado deverá registrar versão de pipeline, versão de prompt, versão de modelo, versão de contrato e versão de regras de normalização. Isso permitirá comparação entre execuções e auditoria de evolução técnica.

## Contrato da API orquestradora

**Qual rota você imagina inicialmente?**  
R: /v1/parsing/jobs.  
J: A API principal do MVP será centrada em jobs. O `POST /v1/parsing/jobs` cria o processamento, e endpoints auxiliares consultam status, metadados e resultado final.

**A resposta deve conter só o texto ou também: documentId, status, pages, engine usado, tempo, warnings, confidence, metadados do arquivo, hash?**  
R: deve conter tudo isso, qualquer coisa que aproveite em uma request.  
J: O contrato será rico em metadados. Na criação do job, a API deverá retornar ao menos `jobId`, `documentId`, `status`, `hash`, `mimeType`, `pages` quando possível, `createdAt` e indicação de reaproveitamento se houver duplicidade. No resultado final, deverá retornar também `engine`, `latency`, `warnings`, `confidence`, `outputVersion` e o payload extraído.

**Quer idempotência por hash do arquivo?**  
R: quero sim.  
J: O orquestrador calculará hash determinístico do conteúdo e consultará execuções anteriores compatíveis. A idempotência será baseada em hash do arquivo combinado com versão de pipeline, evitando colisões lógicas entre versões diferentes do processamento.

**Se o mesmo arquivo entrar duas vezes, deve reprocessar ou reaproveitar resultado?**  
R: reaproveitar resultado.  
J: O comportamento padrão será cache semântico por hash. O sistema só reprocessará quando houver solicitação explícita de nova engine, nova versão ou `forceReprocess=true`.

**Vai existir limite de tamanho, número de páginas e tipos MIME aceitos?**  
R: Sim, por exemplo até 10 páginas, 50mb no máximo e tipos PDF, JPG, PNG.  
J: A validação de entrada ocorrerá antes do documento ser efetivamente aceito para processamento. Arquivos fora do limite deverão falhar cedo com códigos padronizados, sem ocupar fila nem storage derivado desnecessariamente.

## Worker LLM/OCR

**O worker vai receber o arquivo bruto, imagens por página ou referência em storage?**  
R: Vai receber o arquivo bruto, o worker é responsável por fazer a renderização por página e depois processar.  
J: O worker será responsável por renderização por página, normalização e extração. Como o transporte do binário bruto pelo broker não é desejável, o comportamento definitivo será: o arquivo bruto será persistido no MinIO e a mensagem do job enviará apenas uma referência segura (`bucket`, `objectKey`, `versionId` ou equivalente). Assim, o worker continua operando sobre o arquivo bruto original, mas sem comprometer performance e estabilidade da mensageria.

**Você quer uma pipeline fixa ou quer deixar isso plugável?**  
R: Quero deixar isso plugável, para no futuro poder colocar mais etapas ou mudar a ordem.  
J: O worker será estruturado como pipeline plugável por etapas, com contratos internos claros entre normalização, renderização, OCR, heurísticas, LLM, pós-processamento e agregação. A ordem operacional não ficará hardcoded no domínio.

**Haverá fallback entre engines?**  
R: Sim, pode ser assim.  
J: O comportamento padrão será `OCR tradicional -> validação heurística -> fallback para LLM quando necessário`. Isso reduz custo, melhora previsibilidade e mantém trilha de decisão técnica auditável.

**No MVP, o worker será orientado a texto puro ou já vai devolver estrutura interna rica para o orquestrador simplificar depois?**  
R: O worker vai retornar o texto já formatado com marcações de campos, checkbox e manuscrito, para o orquestrador só ter que repassar.  
J: O worker não será um OCR cego. Ele devolverá um resultado semântico enriquecido, e o orquestrador atuará como coordenador, persistidor, versionador e expositor da resposta.

## Manuscrito

**Manuscrito é requisito do MVP ou apenas preocupação de arquitetura?**  
R: Manuscrito é requisito do MVP, quero que já venha marcado no texto o que é manuscrito e o que é texto impresso.  
J: Manuscrito entra como requisito funcional do MVP. O resultado deverá distinguir texto impresso de texto manuscrito, ainda que a qualidade inicial do manuscrito seja imperfeita.

**Quando falamos “pegar manuscritos”, estamos falando de textos livres escritos à mão, assinaturas, rubricas, pequenas observações, ou tudo?**  
R: textos livres escritos à mão, pequenas observações, mas não assinaturas e rubricas.  
J: O escopo de manuscrito será delimitado a conteúdo semanticamente útil para extração. Assinaturas e rubricas ficam explicitamente fora do MVP.

**Aceita que, no início, manuscrito tenha cobertura parcial e baixa confiança?**  
R: Aceito sim, o importante é já ter isso marcado no texto para depois melhorar a qualidade.  
J: O MVP poderá retornar manuscrito com baixa confiança, desde que isso fique explicitado e nunca seja apresentado como dado confiável sem marcação.

**Quer guardar separadamente trechos manuscritos detectados, mesmo que o MVP devolva só texto final?**  
R: Sim, quero guardar isso para análise futura e possível melhoria.  
J: Os artefatos de manuscrito serão persistidos separadamente como evidência para melhoria futura, análise de falhas, tuning de heurísticas e auditoria de qualidade.

## Template e layout

**Essa ficha tem layout relativamente fixo. Você quer assumir template conhecido desde o início ou tratar como documento genérico?**  
R: Tratar como documento genérico por enquanto, mas já deixar a arquitetura preparada para lidar com templates no futuro.  
J: O processamento inicial será `template-light`: sem dependência rígida de template cadastrado para extrair, mas com o domínio já preparado para incorporar `Template Management` depois. No MVP, o parser funcionará por extração genérica tunada para ficha clínica, sem reprovar documentos apenas por saírem de um padrão visual esperado.

**Vai existir cadastro de templates no futuro?**  
R: Sim, no futuro quero ter um módulo de cadastro de templates para facilitar a extração estruturada por campos.  
J: O módulo de templates deverá existir como contexto separado desde já, ainda que seja implementado depois. Isso preserva a evolução sem exigir refatoração estrutural pesada.

**Se sim, você quer já separar isso no domínio, mesmo sem implementar agora?**  
R: Sim, quero já separar isso no domínio para facilitar a implementação futura.  
J: O domínio terá interfaces e objetos preparados para template, mas o MVP não precisará expor CRUD completo dessa capacidade.

**Quando um documento não bater com template conhecido, o sistema deve seguir extração genérica, marcar como desconhecido, ou falhar?**  
R: Marcar como desconhecido e retornar apenas um erro, para depois analisar e possivelmente criar um template novo.  
J: Esse comportamento ficará reservado para a fase em que a classificação por template estiver ativa como capacidade formal do produto. No MVP, como não haverá template obrigatório, o documento deverá seguir pela extração genérica. Quando o módulo de template estiver ativo no futuro, o sistema poderá marcar `templateStatus=UNKNOWN`, registrar o motivo e retornar erro funcional padronizado para análise posterior.

## Qualidade e verdade do resultado

**Qual é a tolerância a erro?**  
R: Tolerância a erro é baixa, quero que o resultado seja o mais preciso possível, mas aceito que no início tenha algumas falhas, principalmente em manuscrito.  
J: O sistema será calibrado para priorizar precisão sobre agressividade de preenchimento. Em caso de ambiguidade, deverá preferir sinalizar baixa confiança ou ilegibilidade, em vez de inferir valores plausíveis sem base suficiente.

**Pode haver texto embaralhado em regiões com tabelas e caixas?**  
R: Sim, pode haver texto embaralhado nessas regiões, o importante é que o texto seja extraído mesmo que a ordem não seja perfeita.  
J: A qualidade será julgada mais por cobertura e preservação semântica do que por fidelidade exata à ordem visual em tabelas, grupos de checkbox e regiões complexas.

**Você quer score de confiança por documento agora ou isso pode ficar para depois?**  
R: Quero score de confiança por documento já no MVP, para ter uma métrica de qualidade desde o início.  
J: O contrato final terá score de confiança em nível de documento e, preferencialmente, também por item ou campo relevante. Esse score deverá agregar sinais do OCR, do fallback, da normalização e das validações heurísticas.

**Como você pretende validar qualidade: comparação humana, golden dataset, amostra manual?**  
R: Pretendo validar com golden dataset apenas, para ter uma comparação objetiva e consistente.  
J: O aceite técnico do MVP será sustentado por um golden dataset versionado, com comparações reprodutíveis entre saída esperada e saída real.

**Já existe um conjunto inicial de documentos reais para teste além desse PDF?**  
R: Ainda não, mas pretendo reunir um conjunto de documentos reais para teste em breve.  
J: O desenvolvimento deverá prever desde já a entrada futura de dataset real, mas não depender dele para iniciar arquitetura, contratos e pipeline. Isso permite começar com um conjunto pequeno e ampliar a robustez depois.

## Performance e operação

**Qual volume esperado no início e em escala?**  
R: No início, espero processar cerca de 10-20 documentos por dia, mas em escala quero chegar a 100-200 documentos por dia, quero chegar em algo de 20k de documentos por mês.  
J: O MVP deverá nascer pequeno, mas com desenho operacional compatível com crescimento moderado. Isso reforça a escolha por fila, persistência, DLQ, storage externo e processamento desacoplado.

**Qual SLA aceitável por documento?**  
R: SLA aceitável é de até 30 segundos por documento, mas idealmente gostaria de algo em torno de 10-15 segundos.  
J: O orçamento de latência do pipeline será orientado a 30 segundos como teto funcional e 10-15 segundos como meta operacional. Métricas por etapa serão obrigatórias para localizar gargalos.

**Tudo bem levar vários segundos se a qualidade for melhor?**  
R: Sim, tudo bem levar mais tempo se a qualidade for significativamente melhor, mas quero evitar tempos muito longos que possam impactar a experiência do usuário.  
J: O sistema poderá aplicar fallback mais caro quando houver ganho claro de qualidade, mas essa política deverá ser controlada por limiares objetivos para não degradar a fila inteira.

**Vai rodar em fila sempre ou precisa ter modo síncrono para documentos pequenos?**  
R: Vai rodar em fila sempre, para garantir escalabilidade e resiliência, mesmo para documentos pequenos.  
J: Todo processamento será orientado a job, sem exceções no MVP. Isso simplifica o modelo operacional, evita duplicidade de fluxo e preserva previsibilidade arquitetural.

**Quer armazenar resultado para consulta posterior ou responder e descartar?**  
R: Quero armazenar o resultado para consulta posterior, para ter um histórico e possibilitar análises futuras.  
J: Resultado e artefatos serão persistidos para histórico, comparação entre versões, auditoria e reprocessamento controlado.

## Segurança e compliance

**Onde o arquivo será armazenado?**  
R: quero usar o minIO para armazenamento, com bucket privado e acesso controlado.  
J: O storage primário de binários será MinIO privado, com acesso por credenciais de serviço e políticas restritas por bucket e prefixo.

**Por quanto tempo?**  
R: quero armazenar os documentos por pelo menos 1 ano, para ter histórico e possibilidade de reprocessamento, mas isso pode ser ajustado conforme necessidade.  
J: A retenção inicial será de 1 ano, com política configurável por ambiente e por categoria de artefato quando necessário.

**Quem pode acessar?**  
R: apenas usuários autorizados, com controle de acesso baseado em roles, e acesso auditado.  
J: O sistema exigirá RBAC para acesso a documentos, resultados e artefatos, com trilha de auditoria para leitura, download e ações administrativas.

**Se haverá mascaramento em logs?**  
R: sim, quero mascarar informações sensíveis em logs para garantir a privacidade e segurança dos dados.  
J: Logs operacionais não deverão conter payloads sensíveis em claro. O padrão será logar IDs, hashes, status, versões e motivos de falha, nunca o conteúdo textual integral do documento.

**Se resultado textual ficará persistido?**  
R: sim, o resultado textual ficará persistido, mas com acesso controlado e criptografia em repouso para garantir a segurança dos dados.  
J: O texto extraído será persistido como dado protegido, sujeito a controle de acesso, criptografia em repouso e trilha de auditoria.

**Se prompts enviados ao modelo podem conter PII integral.**  
R: Não, quero evitar enviar PII integral nos prompts para o modelo, prefiro usar pseudonimização ou mascaramento para proteger a privacidade dos dados.  
J: A política de IA será de minimização de dados. Como o OCR rodará em infraestrutura própria e o LLM usará provedor externo, o comportamento definitivo será: OCR pode operar com texto bruto internamente, mas toda etapa que envolver LLM externo deverá aplicar mascaramento ou pseudonimização obrigatória antes do envio do prompt.

**Você quer anonimização ou pseudonimização em algum ponto do fluxo?**  
R: Sim, quero implementar pseudonimização no futuro, para proteger a identidade dos pacientes e garantir compliance com regulamentações de privacidade.  
J: A pseudonimização entrará como capacidade planejada do pipeline, idealmente como etapa transversal antes da chamada a componentes que não precisem de identificação real.

## Observabilidade

**No MVP, o que você quer logar por documento? Quer métricas desde já?**  
R: Sim, quero logar tudo isso por documento, para ter uma visão completa do processamento e poder analisar falhas e oportunidades de melhoria. E sim, quero métricas desde já, para acompanhar o desempenho e a qualidade do sistema desde o início, vamos usar um datadog ou algo similar para isso.  
J: Observabilidade é requisito do MVP. Cada documento deverá ter trilha mínima com `documentId`, `jobId`, `hash`, `mimeType`, `pages`, `status`, `engine`, `latency`, `fallbackUsed`, `retryCount`, `errorCode`, `pipelineVersion` e custo estimado quando aplicável. Métricas, logs estruturados e traces deverão ser integrados desde o início.

## Erros e reprocessamento

**Quais falhas precisam existir no contrato?**  
R: Sim, quero ter todas essas falhas no contrato, para poder lidar com elas de forma adequada e fornecer feedback claro para os usuários e consumidores da API.  
J: O contrato terá taxonomia explícita de erro, cobrindo validação de arquivo, corrupção, ausência de texto detectável, timeout, parcialidade de OCR, indisponibilidade de modelo e resultado vazio. Os erros deverão ser funcionais e técnicos, não apenas HTTP genérico.

**Você quer permitir reprocessamento manual com outro engine ou versão?**  
R: Sim, quero permitir reprocessamento manual, para casos em que o resultado inicial não seja satisfatório ou quando novas versões de engines ou modelos estejam disponíveis.  
J: O sistema terá capacidade de reprocessamento controlado, criando nova execução versionada sem destruir nem sobrescrever o resultado anterior.

**Quer DLQ desde o início ou ainda não?**  
R: Sim, quero ter uma DLQ desde o início, para garantir que mensagens que não puderam ser processadas sejam armazenadas para análise e possível reprocessamento futuro.  
J: A mensageria do MVP terá DLQ obrigatória, com metadados suficientes para diagnóstico, rastreabilidade e replay manual.

## Arquitetura hexagonal

**Você quer que eu proponha portas e adaptadores já no desenho inicial? A pergunta aqui é: você quer um monorepo com módulos claros ou dois serviços separados desde o começo, cada um com seu próprio hexágono?**  
R: Dois serviços separados desde o começo, um para orquestração e outro para processamento, cada um com seu próprio hexágono, para garantir uma separação clara de responsabilidades e facilitar a evolução futura de cada um dos serviços.  
J: A solução terá dois serviços independentes desde o início: `orchestrator-api` e `document-processing-worker`. Cada um terá seu próprio hexágono, sua própria camada de aplicação e seus adaptadores específicos. A comunicação entre eles será assíncrona e baseada em mensagens de job.

## Persistência

**Você quer banco já no MVP?**  
R: Sim, quero ter um banco já no MVP, para armazenar os documentos, resultados, status dos jobs e outros dados relevantes de forma estruturada e consultável. Penso em mongoDB para isso pois é um problema não relacional e pode ser mais flexível para evoluir o modelo de dados conforme necessário.  
J: O MVP terá persistência desde o início. MongoDB é coerente com a necessidade de armazenar resultados semiestruturados, artefatos versionados, payloads documentais evolutivos e múltiplas execuções do mesmo documento.

**Quais dados precisam persistir?**  
R: Sim, quero persistir todos esses dados, para ter um histórico completo do processamento de cada documento e poder analisar falhas, qualidade e evolução ao longo do tempo.  
J: Serão persistidos metadados do documento, status do job, resultado textual, artefatos intermediários, erros, versões de pipeline, referências de storage e histórico de reprocessamentos. O banco será a fonte de consulta; o storage será a fonte dos binários.

**Quer armazenar imagens renderizadas por página ou só o original?**  
R: As duas, quero armazenar o original para referência e possível reprocessamento, e as imagens renderizadas por página para análise e melhoria do processo de extração, especialmente em casos de falhas ou baixa qualidade.  
J: Serão persistidos o arquivo original e os artefatos derivados por página, com relação clara entre eles. Isso facilita debug, comparação entre engines, melhoria do pipeline e evidência técnica de falhas.

## Estratégia de versão

**Você quer versionar API, pipeline, prompt, modelo, contrato de saída?**  
R: Sim, quero versionar tudo isso, para garantir uma evolução controlada e transparente do sistema, e para facilitar a identificação de mudanças e melhorias ao longo do tempo.  
J: Todo resultado será carimbado com as versões relevantes do ecossistema: API, pipeline, prompt, modelo, contrato de saída e regras auxiliares. Isso permitirá comparar execuções antigas e novas sem ambiguidade técnica.

## Testes e aceite

**Qual será o critério formal de aceite do MVP?**  
R: Aceita PDF até 10 páginas, retorna texto único concatenado, mantém marcações de campos, checkbox e manuscrito, processa em até 30 segundos, falha com código padronizado e mensagem clara quando ilegível ou quando o documento não bater com template conhecido.  
J: O aceite do MVP será orientado a contrato e golden dataset. O parser deverá aceitar PDF, JPG e PNG dentro dos limites definidos, produzir saída concatenada com marcações semânticas de campos, checkbox e manuscrito, respeitar SLA de até 30 segundos e retornar erros padronizados para cenários inválidos ou ilegíveis. A parte de “falhar quando o documento não bater com template conhecido” não se aplica ao MVP, porque nesta fase o fluxo será genérico e sem template obrigatório; essa regra ficará reservada para a fase futura em que a classificação por template estiver formalmente ativada.

## Dúvidas abertas consolidadas

Nenhuma dúvida aberta crítica. As três questões estruturais pendentes foram fechadas assim:

1. **Transporte do arquivo entre serviços**  
   O worker receberá uma referência segura do arquivo armazenado no MinIO, e não o binário trafegando pela fila.

2. **Estratégia real de template no MVP**  
   O MVP operará sem template obrigatório, usando extração genérica tunada para ficha clínica. O tratamento de `templateStatus=UNKNOWN` com erro funcional fica para a fase em que template classification estiver ativa.

3. **Política de PII e execução de IA**  
   OCR em infraestrutura própria poderá operar com conteúdo bruto. Toda chamada a LLM externo exigirá mascaramento ou pseudonimização antes do envio do prompt.
