import type {
  OcrEnginePort,
  PageRendererPort
} from '../../../../domain/extraction/extraction-ports';
import type {
  PageExtraction,
  RenderedPage
} from '../../../../domain/extraction/extraction.types';
import type { HeuristicEvaluationService } from '../../../../domain/extraction/heuristic-evaluation.service';
import type { TextNormalizationService } from '../../../../domain/extraction/text-normalization.service';
import type { ArtifactReferenceFactory } from './artifact-reference.factory';

export class PageExtractionStage {
  public constructor(
    private readonly pageRenderer: PageRendererPort,
    private readonly ocrEngine: OcrEnginePort,
    private readonly normalizationService: TextNormalizationService,
    private readonly heuristicEvaluationService: HeuristicEvaluationService,
    private readonly artifactReferenceFactory: ArtifactReferenceFactory
  ) {}

  public async extract(input: {
    jobId: string;
    mimeType: string;
    original: Buffer;
    pageCount: number;
  }): Promise<{ renderedPages: RenderedPage[]; pageExtractions: PageExtraction[] }> {
    const renderedPages = await this.pageRenderer.render({
      mimeType: input.mimeType,
      original: input.original,
      pageCount: input.pageCount
    });
    const pageExtractions: PageExtraction[] = [];

    for (const page of renderedPages) {
      const rawOcr = await this.ocrEngine.extract({ page });
      const normalizedText = this.normalizationService.normalizeOcrTextByPage(rawOcr.rawText);

      pageExtractions.push({
        pageNumber: page.pageNumber,
        renderReference: this.artifactReferenceFactory.buildRenderArtifact(input.jobId, page),
        rawOcrReference: this.artifactReferenceFactory.buildRawOcrArtifact(
          input.jobId,
          page.pageNumber,
          rawOcr
        ),
        rawOcrText: rawOcr.rawText,
        normalizedText,
        handwrittenSegments: this.heuristicEvaluationService.detectHandwrittenSegments({
          pageNumber: page.pageNumber,
          normalizedText
        }),
        checkboxFindings: this.heuristicEvaluationService.detectCheckboxFindings({
          pageNumber: page.pageNumber,
          normalizedText
        }),
        criticalFieldFindings: this.heuristicEvaluationService.detectCriticalFieldFindings({
          pageNumber: page.pageNumber,
          normalizedText
        }),
        confidenceScore: rawOcr.confidenceScore
      });
    }

    return {
      renderedPages,
      pageExtractions
    };
  }
}
