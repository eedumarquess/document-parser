import { ExtractionWarning, FallbackReason } from '@document-parser/shared-kernel';
import { HeuristicEvaluationService } from '../../src/domain/extraction/heuristic-evaluation.service';
import { SensitiveDataMaskingService } from '../../src/domain/extraction/sensitive-data-masking.service';
import { TextConsolidationService } from '../../src/domain/extraction/text-consolidation.service';
import { TextNormalizationService } from '../../src/domain/extraction/text-normalization.service';

describe('TextNormalizationService', () => {
  const service = new TextNormalizationService();

  it('normalizes direct checkbox markers into the MVP grammar', () => {
    expect(
      service.normalizeOcrTextByPage('%PDF-1.4\n/Type /Page\n[[CHECKED:febre]] [[UNCHECKED:tosse]]')
    ).toBe('febre: [marcado] tosse: [desmarcado]');
  });
});

describe('SensitiveDataMaskingService', () => {
  const service = new SensitiveDataMaskingService();

  it('masks identifiers before sending text to an external LLM', () => {
    expect(service.maskForExternalLlm('cpf 123.456.789-00 email user@example.com')).toBe(
      'cpf [cpf] email [email]'
    );
  });
});

describe('HeuristicEvaluationService', () => {
  const normalization = new TextNormalizationService();
  const service = new HeuristicEvaluationService(normalization);

  it('creates fallback targets for OCR empty, handwriting, ambiguous checkbox and critical field markers', () => {
    const pages = [
      {
        pageNumber: 1,
        renderReference: {
          artifactId: 'render-1',
          artifactType: 'RENDERED_IMAGE',
          storageBucket: 'artifacts',
          storageObjectKey: 'render/job/page-1.png',
          mimeType: 'image/png',
          pageNumber: 1
        },
        rawOcrReference: {
          artifactId: 'ocr-1',
          artifactType: 'OCR_JSON',
          storageBucket: 'artifacts',
          storageObjectKey: 'ocr/job/page-1.json',
          mimeType: 'application/json',
          pageNumber: 1
        },
        rawOcrText:
          '[[HANDWRITING:Dor ha 2 dias]] [[AMBIGUOUS_CHECKBOX:febre:checked]] [[CRITICAL_MISSING:diagnostico:Dengue]]',
        normalizedText:
          '[[HANDWRITING:Dor ha 2 dias]] [[AMBIGUOUS_CHECKBOX:febre:checked]] [[CRITICAL_MISSING:diagnostico:Dengue]]',
        handwrittenSegments: service.detectHandwrittenSegments({
          pageNumber: 1,
          normalizedText: '[[HANDWRITING:Dor ha 2 dias]]'
        }),
        checkboxFindings: service.detectCheckboxFindings({
          pageNumber: 1,
          normalizedText: '[[AMBIGUOUS_CHECKBOX:febre:checked]]'
        }),
        criticalFieldFindings: service.detectCriticalFieldFindings({
          pageNumber: 1,
          normalizedText: '[[CRITICAL_MISSING:diagnostico:Dengue]]'
        }),
        confidenceScore: 0.62
      }
    ];

    const targets = service.evaluateFallbackTargets({
      pages,
      renderedPages: [
        {
          pageNumber: 1,
          mimeType: 'image/png',
          sourceText:
            '[[OCR_EMPTY]] [[HANDWRITING:Dor ha 2 dias]] [[AMBIGUOUS_CHECKBOX:febre:checked]] [[CRITICAL_MISSING:diagnostico:Dengue]]'
        }
      ]
    });

    expect(targets.map((target) => target.fallbackReason)).toEqual(
      expect.arrayContaining([
        FallbackReason.HANDWRITING_DETECTED,
        FallbackReason.CHECKBOX_AMBIGUOUS,
        FallbackReason.CRITICAL_TARGET_MISSING
      ])
    );
  });

  it('creates a low-confidence page fallback when OCR confidence drops below the threshold', () => {
    const targets = service.evaluateFallbackTargets({
      pages: [
        {
          pageNumber: 1,
          renderReference: {
            artifactId: 'render-1',
            artifactType: 'RENDERED_IMAGE',
            storageBucket: 'artifacts',
            storageObjectKey: 'render/job/page-1.png',
            mimeType: 'image/png',
            pageNumber: 1
          },
          rawOcrReference: {
            artifactId: 'ocr-1',
            artifactType: 'OCR_JSON',
            storageBucket: 'artifacts',
            storageObjectKey: 'ocr/job/page-1.json',
            mimeType: 'application/json',
            pageNumber: 1
          },
          rawOcrText: 'texto com baixa confianca',
          normalizedText: 'texto com baixa confianca',
          handwrittenSegments: [],
          checkboxFindings: [],
          criticalFieldFindings: [],
          confidenceScore: 0.3
        },
        {
          pageNumber: 2,
          renderReference: {
            artifactId: 'render-2',
            artifactType: 'RENDERED_IMAGE',
            storageBucket: 'artifacts',
            storageObjectKey: 'render/job/page-2.png',
            mimeType: 'image/png',
            pageNumber: 2
          },
          rawOcrReference: {
            artifactId: 'ocr-2',
            artifactType: 'OCR_JSON',
            storageBucket: 'artifacts',
            storageObjectKey: 'ocr/job/page-2.json',
            mimeType: 'application/json',
            pageNumber: 2
          },
          rawOcrText: 'texto confiavel',
          normalizedText: 'texto confiavel',
          handwrittenSegments: [],
          checkboxFindings: [],
          criticalFieldFindings: [],
          confidenceScore: 0.92
        }
      ],
      renderedPages: [
        {
          pageNumber: 1,
          mimeType: 'image/png',
          sourceText: 'texto com baixa confianca'
        },
        {
          pageNumber: 2,
          mimeType: 'image/png',
          sourceText: 'texto confiavel'
        }
      ]
    });

    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetType: 'PAGE',
          fallbackReason: FallbackReason.LOW_GLOBAL_CONFIDENCE
        })
      ])
    );
  });

  it('computes warnings from unresolved targets and illegible payload fragments', () => {
    const result = service.calculateConfidenceAndWarnings({
      pages: [],
      payload: 'texto [ilegivel]',
      targets: [
        {
          targetId: 'checkbox-1',
          targetType: 'CHECKBOX',
          targetLocator: { locatorType: 'CHECKBOX', pageNumber: 1 },
          sourceText: 'checkbox:febre:checked',
          fallbackReason: FallbackReason.CHECKBOX_AMBIGUOUS,
          isCritical: false,
          confidenceScore: 0.2
        },
        {
          targetId: 'handwriting-1',
          targetType: 'HANDWRITING',
          targetLocator: { locatorType: 'TEXT_SEGMENT', pageNumber: 1 },
          sourceText: 'Dor ha 2 dias',
          fallbackReason: FallbackReason.HANDWRITING_DETECTED,
          isCritical: false,
          confidenceScore: 0.2,
          warning: ExtractionWarning.LLM_FALLBACK_UNAVAILABLE
        }
      ]
    });

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        ExtractionWarning.ILLEGIBLE_CONTENT,
        ExtractionWarning.AMBIGUOUS_CHECKBOX,
        ExtractionWarning.HANDWRITING_LOW_CONFIDENCE,
        ExtractionWarning.LLM_FALLBACK_UNAVAILABLE
      ])
    );
  });
});

describe('TextConsolidationService', () => {
  const service = new TextConsolidationService();

  it('builds the final MVP markers for unresolved and resolved targets', () => {
    const pageText = service.mergeFallbackResponsesIntoPageText({
      pageNumber: 1,
      renderReference: {
        artifactId: 'render-1',
        artifactType: 'RENDERED_IMAGE',
        storageBucket: 'artifacts',
        storageObjectKey: 'render/job/page-1.png',
        mimeType: 'image/png',
        pageNumber: 1
      },
      rawOcrReference: {
        artifactId: 'ocr-1',
        artifactType: 'OCR_JSON',
        storageBucket: 'artifacts',
        storageObjectKey: 'ocr/job/page-1.json',
        mimeType: 'application/json',
        pageNumber: 1
      },
      rawOcrText:
        '[[HANDWRITING:Dor ha 2 dias]] [[AMBIGUOUS_CHECKBOX:febre:checked]] [[CRITICAL_MISSING:diagnostico:Dengue]]',
      normalizedText:
        '[[HANDWRITING:Dor ha 2 dias]] [[AMBIGUOUS_CHECKBOX:febre:checked]] [[CRITICAL_MISSING:diagnostico:Dengue]]',
      handwrittenSegments: [
        {
          segmentKey: 'handwriting-1',
          originalMarker: '[[HANDWRITING:Dor ha 2 dias]]',
          sourceText: 'Dor ha 2 dias',
          classification: 'RECOVERED',
          locator: { locatorType: 'TEXT_SEGMENT', pageNumber: 1 },
          resolvedText: 'Dor ha 2 dias',
          confidenceScore: 0.8
        }
      ],
      checkboxFindings: [
        {
          segmentKey: 'checkbox-1',
          originalMarker: '[[AMBIGUOUS_CHECKBOX:febre:checked]]',
          label: 'febre',
          state: 'AMBIGUOUS',
          expectedState: 'CHECKED',
          locator: { locatorType: 'CHECKBOX', pageNumber: 1 },
          resolvedText: 'febre: [marcado]',
          confidenceScore: 0.8
        }
      ],
      criticalFieldFindings: [
        {
          segmentKey: 'field-1',
          originalMarker: '[[CRITICAL_MISSING:diagnostico:Dengue]]',
          fieldName: 'diagnostico',
          sourceText: 'Dengue',
          locator: { locatorType: 'FIELD', pageNumber: 1 },
          confidenceScore: 0.2
        }
      ],
      confidenceScore: 0.6
    });

    expect(pageText).toBe('[manuscrito] Dor ha 2 dias febre: [marcado] diagnostico: [ilegivel]');
  });
});
