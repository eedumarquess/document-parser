# OCR Interno para PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** substituir o fluxo falso de `PDF -> UTF-8 string` por um pipeline interno e nativo de `PDF -> imagens por pagina -> Tesseract OCR`, sem gerar `pageCount` inflado, milhares de artefatos falsos ou `previewText` com lixo binario.

**Architecture:** a API passa a contar paginas de `PDF` com `pdfinfo` e o worker passa a renderizar paginas reais com `pdftoppm` e reconhecer texto com `tesseract`. Os wrappers de binarios nativos ficam em `@document-parser/shared-infrastructure`, os adapters de aplicacao ficam nos apps, e o fallback `LLM` continua sendo somente textual, sem inventar entrada a partir de bytes binarios.

**Tech Stack:** `NestJS`, `TypeScript`, `Jest`, `@document-parser/shared-infrastructure`, `poppler-utils` (`pdfinfo`, `pdftoppm`), `tesseract-ocr`, `tesseract-ocr-por`, Docker multi-stage.

---

## Escopo fechado desta iteracao

- `application/pdf` recebe pipeline nativo interno.
- `image/jpeg` e `image/png` ficam fora desta entrega; o comportamento atual continua temporariamente.
- Se os binarios nativos estiverem ausentes, o sistema deve falhar explicitamente para `PDF`; nunca deve voltar para `Buffer.toString('utf8')`.
- O fallback `LLM` continua baseado em texto. Nesta fase ele nao deve tentar "recuperar" uma pagina PDF inteira quando nao houver `sourceText` textual confiavel.

## Abordagens consideradas

### Opcao A: bibliotecas 100% Node.js

- Vantagem: deploy simples, menos dependencia de SO.
- Desvantagem: menor qualidade para OCR real, parsing/renderizacao de PDF mais fracos, maior risco de continuar errando com documentos reais.

### Opcao B: binarios nativos dentro dos servicos atuais

- Vantagem: melhor equilibrio entre qualidade, previsibilidade e mudanca de escopo.
- Vantagem: resolve o bug real sem criar um terceiro servico agora.
- Desvantagem: aumenta requisitos do container e do ambiente local.

### Opcao C: sidecar/servico interno de OCR

- Vantagem: isolamento operacional e evolucao independente.
- Desvantagem: aumenta muito a superficie de infraestrutura antes de validar o fluxo basico.

### Recomendacao

Seguir a **Opcao B**. Ela resolve o problema observado em [`docs/contexto-problema-pdf-real.md`](/c:/Users/eduar/Programacao/document-parser/docs/contexto-problema-pdf-real.md) com o menor salto arquitetural e preserva o desenho atual de `orchestrator-api` + `document-processing-worker`.

## Decisoes de desenho

- Criar wrappers tecnicos em `packages/shared-infrastructure` para `pdfinfo`, `pdftoppm` e `tesseract`.
- Substituir `SimplePageCounterAdapter` por `PdfInfoPageCounterAdapter` no `orchestrator-api`.
- Introduzir `NativePdfPageRendererAdapter` e `TesseractOcrEngineAdapter` no worker.
- Manter adapters deterministas atuais para testes sinteticos e para MIME fora de escopo, por meio de adapters compostos.
- Evoluir `RenderedPage` para carregar `imageBytes` opcionalmente, sem quebrar os usos atuais que dependem de `sourceText`.
- Bloquear `fallback` de `DOCUMENT` e `PAGE` quando a pagina renderizada nao tiver `sourceText` textual confiavel.
- Adicionar uma protecao em `ArtifactPreviewService` para nao exibir bytes/lixo estrutural caso um artefato ruim escape no futuro.

### Task 1: Contagem real de paginas de PDF no orchestrator

**Files:**
- Create: `packages/shared-infrastructure/src/native/native-command-runner.ts`
- Create: `packages/shared-infrastructure/src/native/temporary-workspace.ts`
- Create: `packages/shared-infrastructure/src/pdf/poppler-pdf-tools.ts`
- Modify: `packages/shared-infrastructure/src/index.ts`
- Create: `apps/orchestrator-api/src/adapters/out/storage/pdfinfo-page-counter.adapter.ts`
- Modify: `apps/orchestrator-api/src/app.module.ts`
- Test: `apps/orchestrator-api/tests/contracts/pdfinfo-page-counter.adapter.spec.ts`

- [ ] **Step 1: Write the failing contract test**

```ts
import { buildUploadedFile } from '@document-parser/testkit';
import { PdfInfoPageCounterAdapter } from '../../src/adapters/out/storage/pdfinfo-page-counter.adapter';

describe('PdfInfoPageCounterAdapter contract', () => {
  it('counts PDF pages from poppler metadata instead of UTF-8 regex', async () => {
    const pdfTools = {
      inspect: jest.fn().mockResolvedValue({ pageCount: 3 })
    };
    const adapter = new PdfInfoPageCounterAdapter(pdfTools as never);

    await expect(
      adapter.countPages(
        buildUploadedFile({
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.7 binary fixture')
        })
      )
    ).resolves.toBe(3);

    expect(pdfTools.inspect).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec jest --config jest.workspace.config.cjs --selectProjects orchestrator-contracts --runTestsByPath apps/orchestrator-api/tests/contracts/pdfinfo-page-counter.adapter.spec.ts --runInBand`
Expected: FAIL with `Cannot find module '../../src/adapters/out/storage/pdfinfo-page-counter.adapter'`.

- [ ] **Step 3: Implement the shared poppler wrapper and orchestrator adapter**

```ts
// packages/shared-infrastructure/src/native/native-command-runner.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FatalFailureError } from '@document-parser/shared-kernel';

const execFileAsync = promisify(execFile);

export class NativeCommandRunner {
  public async run(command: string, args: string[]) {
    try {
      return await execFileAsync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    } catch (error) {
      throw new FatalFailureError('Native PDF/OCR command failed', {
        command,
        args,
        cause: error instanceof Error ? error.message : 'unknown'
      });
    }
  }
}
```

```ts
// packages/shared-infrastructure/src/native/temporary-workspace.ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export async function withTemporaryFile<T>(
  buffer: Buffer,
  extension: string,
  work: (filePath: string) => Promise<T>
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'document-parser-'));
  const filePath = join(directory, `input${extension}`);

  await writeFile(filePath, buffer);

  try {
    return await work(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
```

```ts
// packages/shared-infrastructure/src/pdf/poppler-pdf-tools.ts
import { FatalFailureError } from '@document-parser/shared-kernel';

export class PopplerPdfTools {
  public constructor(
    private readonly runner = new NativeCommandRunner(),
    private readonly pdfinfoBinary = process.env.PDFINFO_BINARY?.trim() || 'pdfinfo',
    private readonly pdftoppmBinary = process.env.PDFTOPPM_BINARY?.trim() || 'pdftoppm'
  ) {}

  public async inspect(buffer: Buffer): Promise<{ pageCount: number }> {
    return withTemporaryFile(buffer, '.pdf', async (filePath) => {
      const { stdout } = await this.runner.run(this.pdfinfoBinary, [filePath]);
      const match = stdout.match(/^Pages:\s+(\d+)$/m);
      if (match === null) {
        throw new FatalFailureError('Unable to determine PDF page count via pdfinfo', {
          tool: this.pdfinfoBinary
        });
      }

      return { pageCount: Number(match[1]) };
    });
  }

  public async renderPages(buffer: Buffer): Promise<Array<{
    pageNumber: number;
    mimeType: 'image/png';
    imageBytes: Buffer;
    sourceText: string;
  }>> {
    return withTemporaryFile(buffer, '.pdf', async (filePath) => {
      const outputPrefix = `${filePath}-page`;
      await this.runner.run(this.pdftoppmBinary, ['-png', filePath, outputPrefix]);

      const imageFiles = (await readdir(dirname(filePath)))
        .filter((name) => name.startsWith('input.pdf-page-') && name.endsWith('.png'))
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

      return Promise.all(
        imageFiles.map(async (name, index) => ({
          pageNumber: index + 1,
          mimeType: 'image/png' as const,
          imageBytes: await readFile(join(dirname(filePath), name)),
          sourceText: ''
        }))
      );
    });
  }
}
```

```ts
// apps/orchestrator-api/src/adapters/out/storage/pdfinfo-page-counter.adapter.ts
import { Injectable } from '@nestjs/common';
import type { UploadedFile } from '../../../contracts/models';
import type { PageCounterPort } from '../../../contracts/ports';
import { PopplerPdfTools } from '@document-parser/shared-infrastructure';

@Injectable()
export class PdfInfoPageCounterAdapter implements PageCounterPort {
  public constructor(private readonly pdfTools = new PopplerPdfTools()) {}

  public async countPages(file: UploadedFile): Promise<number> {
    const { pageCount } = await this.pdfTools.inspect(file.buffer);
    return Math.max(1, pageCount);
  }
}
```

```ts
// apps/orchestrator-api/src/app.module.ts
{ provide: TOKENS.PAGE_COUNTER, useValue: overrides.pageCounter ?? new PdfInfoPageCounterAdapter() },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm exec jest --config jest.workspace.config.cjs --selectProjects orchestrator-contracts --runTestsByPath apps/orchestrator-api/tests/contracts/pdfinfo-page-counter.adapter.spec.ts --runInBand`
Expected: PASS with `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-infrastructure/src/native/native-command-runner.ts packages/shared-infrastructure/src/native/temporary-workspace.ts packages/shared-infrastructure/src/pdf/poppler-pdf-tools.ts packages/shared-infrastructure/src/index.ts apps/orchestrator-api/src/adapters/out/storage/pdfinfo-page-counter.adapter.ts apps/orchestrator-api/src/app.module.ts apps/orchestrator-api/tests/contracts/pdfinfo-page-counter.adapter.spec.ts
git commit -m "feat(orchestrator): count pdf pages with pdfinfo"
```

### Task 2: Renderizacao nativa de PDF e OCR local no worker

**Files:**
- Modify: `apps/document-processing-worker/src/domain/extraction/extraction.types.ts`
- Create: `packages/shared-infrastructure/src/ocr/tesseract-ocr-tools.ts`
- Modify: `packages/shared-infrastructure/src/index.ts`
- Create: `apps/document-processing-worker/src/adapters/out/extraction/native-pdf-page-renderer.adapter.ts`
- Create: `apps/document-processing-worker/src/adapters/out/extraction/composite-page-renderer.adapter.ts`
- Create: `apps/document-processing-worker/src/adapters/out/extraction/tesseract-ocr-engine.adapter.ts`
- Create: `apps/document-processing-worker/src/adapters/out/extraction/composite-ocr-engine.adapter.ts`
- Modify: `apps/document-processing-worker/src/adapters/out/extraction/deterministic-ocr-engine.adapter.ts`
- Modify: `apps/document-processing-worker/src/adapters/out/extraction/default-extraction.factory.ts`
- Modify: `apps/document-processing-worker/src/adapters/out/extraction/internal/artifact-reference.factory.ts`
- Test: `apps/document-processing-worker/tests/contracts/native-pdf-page-renderer.adapter.spec.ts`
- Test: `apps/document-processing-worker/tests/contracts/tesseract-ocr-engine.adapter.spec.ts`

- [ ] **Step 1: Write the failing renderer and OCR contract tests**

```ts
import { NativePdfPageRendererAdapter } from '../../src/adapters/out/extraction/native-pdf-page-renderer.adapter';

describe('NativePdfPageRendererAdapter contract', () => {
  it('returns one rendered page per PDF page with image bytes', async () => {
    const pdfTools = {
      renderPages: jest.fn().mockResolvedValue([
        { pageNumber: 1, mimeType: 'image/png', imageBytes: Buffer.from('page-1'), sourceText: '' },
        { pageNumber: 2, mimeType: 'image/png', imageBytes: Buffer.from('page-2'), sourceText: '' }
      ])
    };
    const adapter = new NativePdfPageRendererAdapter(pdfTools as never);

    await expect(
      adapter.render({
        mimeType: 'application/pdf',
        original: Buffer.from('%PDF-1.7 binary fixture'),
        pageCount: 2
      })
    ).resolves.toHaveLength(2);
  });
});
```

```ts
import { TesseractOcrEngineAdapter } from '../../src/adapters/out/extraction/tesseract-ocr-engine.adapter';

describe('TesseractOcrEngineAdapter contract', () => {
  it('extracts OCR from rendered image bytes', async () => {
    const ocrTools = {
      recognize: jest.fn().mockResolvedValue({
        text: 'Paciente consciente',
        confidenceScore: 0.91,
        rawPayload: { provider: 'tesseract', language: 'por' }
      })
    };
    const adapter = new TesseractOcrEngineAdapter(ocrTools as never);

    const result = await adapter.extract({
      page: {
        pageNumber: 1,
        mimeType: 'image/png',
        imageBytes: Buffer.from('png-binary'),
        sourceText: ''
      }
    });

    expect(result.rawText).toBe('Paciente consciente');
    expect(result.rawPayload).toMatchObject({ provider: 'tesseract' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm exec jest --config jest.workspace.config.cjs --selectProjects worker-contracts --runTestsByPath apps/document-processing-worker/tests/contracts/native-pdf-page-renderer.adapter.spec.ts apps/document-processing-worker/tests/contracts/tesseract-ocr-engine.adapter.spec.ts --runInBand`
Expected: FAIL because the adapters and the `imageBytes` contract do not exist yet.

- [ ] **Step 3: Implement native PDF rendering, local OCR, and composite wiring**

```ts
// apps/document-processing-worker/src/domain/extraction/extraction.types.ts
export type RenderedPage = {
  pageNumber: number;
  mimeType: string;
  sourceText: string;
  imageBytes?: Buffer;
};
```

```ts
// packages/shared-infrastructure/src/ocr/tesseract-ocr-tools.ts
export class TesseractOcrTools {
  public constructor(
    private readonly runner = new NativeCommandRunner(),
    private readonly binary = process.env.TESSERACT_BINARY?.trim() || 'tesseract',
    private readonly language = process.env.TESSERACT_LANGUAGE?.trim() || 'por'
  ) {}

  public async recognize(imageBytes: Buffer): Promise<{
    text: string;
    confidenceScore: number;
    rawPayload: Record<string, unknown>;
  }> {
    return withTemporaryFile(imageBytes, '.png', async (filePath) => {
      const { stdout, stderr } = await this.runner.run(this.binary, [filePath, 'stdout', '-l', this.language]);
      return {
        text: stdout.trim(),
        confidenceScore: stdout.trim() === '' ? 0.12 : 0.9,
        rawPayload: {
          provider: 'tesseract',
          language: this.language,
          stderr
        }
      };
    });
  }
}
```

```ts
// apps/document-processing-worker/src/adapters/out/extraction/native-pdf-page-renderer.adapter.ts
import { Injectable } from '@nestjs/common';
import { PopplerPdfTools } from '@document-parser/shared-infrastructure';

@Injectable()
export class NativePdfPageRendererAdapter implements PageRendererPort {
  public constructor(private readonly pdfTools = new PopplerPdfTools()) {}

  public async render(input: { mimeType: string; original: Buffer; pageCount: number }) {
    return this.pdfTools.renderPages(input.original);
  }
}
```

```ts
// apps/document-processing-worker/src/adapters/out/extraction/tesseract-ocr-engine.adapter.ts
import { Injectable } from '@nestjs/common';
import { TesseractOcrTools } from '@document-parser/shared-infrastructure';
import { FatalFailureError } from '@document-parser/shared-kernel';

@Injectable()
export class TesseractOcrEngineAdapter implements OcrEnginePort {
  public constructor(private readonly ocrTools = new TesseractOcrTools()) {}

  public async extract(input: { page: RenderedPage }): Promise<OcrPageResult> {
    if (input.page.imageBytes === undefined) {
      throw new FatalFailureError('Missing image bytes for native PDF OCR', {
        pageNumber: input.page.pageNumber
      });
    }

    const result = await this.ocrTools.recognize(input.page.imageBytes);
    return {
      pageNumber: input.page.pageNumber,
      rawText: result.text,
      confidenceScore: result.confidenceScore,
      rawPayload: result.rawPayload
    };
  }
}
```

```ts
// apps/document-processing-worker/src/adapters/out/extraction/composite-page-renderer.adapter.ts
export class CompositePageRendererAdapter implements PageRendererPort {
  public constructor(
    private readonly pdfRenderer: PageRendererPort,
    private readonly fallbackRenderer: PageRendererPort
  ) {}

  public render(input: { mimeType: string; original: Buffer; pageCount: number }) {
    return input.mimeType === 'application/pdf'
      ? this.pdfRenderer.render(input)
      : this.fallbackRenderer.render(input);
  }
}
```

```ts
// apps/document-processing-worker/src/adapters/out/extraction/composite-ocr-engine.adapter.ts
export class CompositeOcrEngineAdapter implements OcrEnginePort {
  public constructor(
    private readonly nativePdfOcr: OcrEnginePort,
    private readonly fallbackOcr: OcrEnginePort
  ) {}

  public extract(input: { page: RenderedPage }) {
    return input.page.imageBytes !== undefined
      ? this.nativePdfOcr.extract(input)
      : this.fallbackOcr.extract(input);
  }
}
```

```ts
// apps/document-processing-worker/src/adapters/out/extraction/deterministic-ocr-engine.adapter.ts
const sourceText = input.page.sourceText ?? '';
const markerCount = (sourceText.match(/\[\[/g) ?? []).length;
const rawText = sourceText.includes('[[OCR_EMPTY]]') ? '' : sourceText.trim();
```

```ts
// apps/document-processing-worker/src/adapters/out/extraction/default-extraction.factory.ts
const pageRenderer =
  overrides.pageRenderer ??
  new CompositePageRendererAdapter(
    new NativePdfPageRendererAdapter(),
    new DefaultPageRendererAdapter()
  );

const ocrEngine =
  overrides.ocrEngine ??
  new CompositeOcrEngineAdapter(
    new TesseractOcrEngineAdapter(),
    new DeterministicOcrEngineAdapter()
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm exec jest --config jest.workspace.config.cjs --selectProjects worker-contracts --runTestsByPath apps/document-processing-worker/tests/contracts/native-pdf-page-renderer.adapter.spec.ts apps/document-processing-worker/tests/contracts/tesseract-ocr-engine.adapter.spec.ts --runInBand`
Expected: PASS with `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-infrastructure/src/ocr/tesseract-ocr-tools.ts packages/shared-infrastructure/src/index.ts apps/document-processing-worker/src/domain/extraction/extraction.types.ts apps/document-processing-worker/src/adapters/out/extraction/native-pdf-page-renderer.adapter.ts apps/document-processing-worker/src/adapters/out/extraction/composite-page-renderer.adapter.ts apps/document-processing-worker/src/adapters/out/extraction/tesseract-ocr-engine.adapter.ts apps/document-processing-worker/src/adapters/out/extraction/composite-ocr-engine.adapter.ts apps/document-processing-worker/src/adapters/out/extraction/deterministic-ocr-engine.adapter.ts apps/document-processing-worker/src/adapters/out/extraction/default-extraction.factory.ts apps/document-processing-worker/src/adapters/out/extraction/internal/artifact-reference.factory.ts apps/document-processing-worker/tests/contracts/native-pdf-page-renderer.adapter.spec.ts apps/document-processing-worker/tests/contracts/tesseract-ocr-engine.adapter.spec.ts
git commit -m "feat(worker): add internal pdf rendering and tesseract ocr"
```

### Task 3: Proteger fallback e preview operacional contra binario/lixo estrutural

**Files:**
- Modify: `apps/document-processing-worker/src/domain/extraction/heuristic-evaluation.service.ts`
- Modify: `apps/document-processing-worker/src/adapters/out/extraction/internal/artifact-reference.factory.ts`
- Modify: `apps/orchestrator-api/src/application/services/artifact-preview.service.ts`
- Test: `apps/document-processing-worker/tests/domain/ocr-llm-extraction.services.spec.ts`
- Test: `apps/orchestrator-api/tests/application/result-delivery.use-cases.spec.ts`

- [ ] **Step 1: Write the failing regression tests**

```ts
it('does not create document/page text fallback when native PDF pages have no sourceText', () => {
  const service = new HeuristicEvaluationService(new TextNormalizationService());

  const targets = service.evaluateFallbackTargets({
    pages: [
      {
        pageNumber: 1,
        rawOcrText: '',
        normalizedText: '',
        handwrittenSegments: [],
        checkboxFindings: [],
        criticalFieldFindings: [],
        confidenceScore: 0.12,
        renderReference: {} as never,
        rawOcrReference: {} as never
      }
    ],
    renderedPages: [
      { pageNumber: 1, mimeType: 'image/png', imageBytes: Buffer.from('png'), sourceText: '' }
    ]
  });

  expect(targets).toEqual([]);
});
```

```ts
it('omits previewText when OCR metadata looks like binary/PDF structure', () => {
  const service = new ArtifactPreviewService(new RedactionPolicyService());

  const response = service.toResponse({
    artifactId: 'artifact-1',
    artifactType: 'OCR_JSON',
    pageNumber: 1,
    mimeType: 'application/json',
    storageBucket: 'artifacts',
    storageObjectKey: 'ocr/job/page-1.json',
    metadata: {
      rawText: '%PDF-1.7 endstream FlateDecode'
    },
    createdAt: new Date('2026-04-03T00:00:00.000Z'),
    retentionUntil: new Date('2026-04-30T00:00:00.000Z'),
    documentId: 'doc-1',
    jobId: 'job-1'
  });

  expect(response.previewText).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm exec jest --config jest.workspace.config.cjs --selectProjects worker-domain orchestrator-application --runTestsByPath apps/document-processing-worker/tests/domain/ocr-llm-extraction.services.spec.ts apps/orchestrator-api/tests/application/result-delivery.use-cases.spec.ts --runInBand`
Expected: FAIL because the current heuristic still generates fallback from `sourceText` and the preview still serializes suspicious OCR payloads.

- [ ] **Step 3: Implement the fallback and preview guards**

```ts
// apps/document-processing-worker/src/domain/extraction/heuristic-evaluation.service.ts
const readableSourcePages = input.renderedPages.filter((page) => page.sourceText.trim() !== '');

if (everyPageNeedsGlobalFallback && readableSourcePages.length > 0) {
  // keep DOCUMENT fallback only when there is actual readable text to send
}

if (renderedPage !== undefined && renderedPage.sourceText.trim() !== '' && page.rawOcrText.trim() === '') {
  // keep PAGE fallback only when there is actual readable text to send
}
```

```ts
// apps/orchestrator-api/src/application/services/artifact-preview.service.ts
private isReadableText(candidate: string): boolean {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(candidate)) {
    return false;
  }

  return !['%PDF-', 'endstream', 'FlateDecode', 'xref'].some((token) => candidate.includes(token));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm exec jest --config jest.workspace.config.cjs --selectProjects worker-domain orchestrator-application --runTestsByPath apps/document-processing-worker/tests/domain/ocr-llm-extraction.services.spec.ts apps/orchestrator-api/tests/application/result-delivery.use-cases.spec.ts --runInBand`
Expected: PASS with the regression covered.

- [ ] **Step 5: Commit**

```bash
git add apps/document-processing-worker/src/domain/extraction/heuristic-evaluation.service.ts apps/document-processing-worker/src/adapters/out/extraction/internal/artifact-reference.factory.ts apps/orchestrator-api/src/application/services/artifact-preview.service.ts apps/document-processing-worker/tests/domain/ocr-llm-extraction.services.spec.ts apps/orchestrator-api/tests/application/result-delivery.use-cases.spec.ts
git commit -m "fix(pdf): block binary fallback and unsafe artifact preview"
```

### Task 4: Fixture real, empacotamento do runtime e smoke test do fluxo PDF

**Files:**
- Create: `packages/testkit/fixtures/pdf/clinical-one-page.pdf`
- Modify: `apps/document-processing-worker/tests/contracts/ocr-llm-extraction.golden-dataset.spec.ts`
- Modify: `apps/document-processing-worker/tests/contracts/real-infrastructure-adapters.spec.ts`
- Modify: `Dockerfile`
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `.env.docker.dev.example`

- [ ] **Step 1: Write the failing smoke test with a real PDF fixture**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDefaultExtractionPipeline } from '../../src/adapters/out/extraction/default-extraction.factory';
import { ProcessingOutcomePolicy } from '../../src/domain/policies/processing-outcome.policy';

const describeNativePdf =
  process.env.RUN_NATIVE_PDF_TESTS === 'true' ? describe : describe.skip;

describeNativePdf('native PDF pipeline smoke', () => {
  it('does not inflate pages or artifacts for a real one-page PDF', async () => {
    const original = readFileSync(
      join(process.cwd(), 'packages/testkit/fixtures/pdf/clinical-one-page.pdf')
    );

    const pipeline = createDefaultExtractionPipeline(new ProcessingOutcomePolicy());
    const outcome = await pipeline.extract({
      ...baseInput,
      original,
      document: {
        ...baseInput.document,
        pageCount: 1
      }
    });

    expect(outcome.artifacts.filter((artifact) => artifact.artifactType === 'OCR_JSON')).toHaveLength(1);
    expect(outcome.payload).not.toContain('FlateDecode');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$env:RUN_NATIVE_PDF_TESTS='true'; corepack pnpm exec jest --config jest.workspace.config.cjs --selectProjects worker-contracts --runTestsByPath apps/document-processing-worker/tests/contracts/ocr-llm-extraction.golden-dataset.spec.ts --runInBand`
Expected: FAIL because the fixture, native binaries, and smoke spec do not exist yet.

- [ ] **Step 3: Add the fixture, install native binaries, and document runtime prerequisites**

```dockerfile
FROM node:22-bookworm-slim AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr tesseract-ocr-por \
  && rm -rf /var/lib/apt/lists/*
```

```env
# .env.example / .env.docker.dev.example
PDFINFO_BINARY=pdfinfo
PDFTOPPM_BINARY=pdftoppm
TESSERACT_BINARY=tesseract
TESSERACT_LANGUAGE=por
```

```md
## OCR interno para PDF

- `PDF` usa `pdfinfo` para contagem de paginas na API
- o worker usa `pdftoppm` para renderizar cada pagina em `PNG`
- o worker usa `tesseract` com idioma `por` para OCR local
- para smoke tests reais, rode `RUN_NATIVE_PDF_TESTS=true`
```

- [ ] **Step 4: Run verification commands**

Run: `corepack pnpm typecheck`
Expected: PASS

Run: `corepack pnpm exec jest --config jest.workspace.config.cjs --selectProjects orchestrator-contracts worker-contracts worker-domain --runInBand`
Expected: PASS with the new PDF-native tests green, except the smoke test when `RUN_NATIVE_PDF_TESTS` is unset.

- [ ] **Step 5: Commit**

```bash
git add packages/testkit/fixtures/pdf/clinical-one-page.pdf apps/document-processing-worker/tests/contracts/ocr-llm-extraction.golden-dataset.spec.ts apps/document-processing-worker/tests/contracts/real-infrastructure-adapters.spec.ts Dockerfile README.md .env.example .env.docker.dev.example
git commit -m "chore(pdf-ocr): package native runtime and smoke tests"
```

## Self-review checklist

- A API nunca mais conta paginas de `PDF` por regex em `utf8`.
- O worker nunca mais converte `PDF` bruto em `string` para renderizar paginas.
- `LLM` nao recebe bytes/binario como `masked_source_text`.
- `previewText` operacional nao replica estrutura de `PDF` se um artefato ruim escapar.
- O plano nao muda o escopo de `JPEG` e `PNG` nesta iteracao.
- Existe um caminho claro para crescer depois: reaproveitar `TesseractOcrEngineAdapter` para imagens e substituir os adapters compostos por um pipeline nativo mais amplo.

## Verificacao antes de implementar

Validar estes pontos antes de executar o plano:

1. `PDF` e a unica entrega fechada desta iteracao.
2. `poppler-utils` + `tesseract-ocr` podem virar dependencia oficial do ambiente local e do container.
3. O fallback `LLM` continua textual e nao sera expandido para `image-to-text` agora.
4. Um smoke test real pode ficar atras de `RUN_NATIVE_PDF_TESTS=true` para nao quebrar maquinas sem os binarios instalados.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-03-ocr-interno-pdf.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
