import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../../..');
const forbiddenTokens = [
  'templateId',
  'templateVersion',
  'templateStatus',
  'matchingRules',
  'TemplateRepositoryPort',
  'CreateTemplateCommand',
  'PublishTemplateVersionCommand',
  'ClassifyDocumentByTemplateCommand'
];

const collectFiles = (directory: string, matcher: RegExp): string[] => {
  const files: string[] = [];

  for (const entry of readdirSync(directory)) {
    const absolutePath = join(directory, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      files.push(...collectFiles(absolutePath, matcher));
      continue;
    }

    if (matcher.test(absolutePath)) {
      files.push(absolutePath);
    }
  }

  return files;
};

describe('Template Management MVP guardrails', () => {
  it('keeps contracts, schemas and runtime code free of template fields while the context is inactive', () => {
    const codeFiles = [
      ...collectFiles(join(repoRoot, 'apps', 'orchestrator-api', 'src'), /\.ts$/),
      ...collectFiles(join(repoRoot, 'apps', 'document-processing-worker', 'src'), /\.ts$/),
      ...collectFiles(join(repoRoot, 'packages', 'document-processing-domain', 'src'), /\.ts$/),
      ...collectFiles(join(repoRoot, 'packages', 'shared-kernel', 'src'), /\.ts$/)
    ];
    const documentationFiles = [
      ...collectFiles(join(repoRoot, 'docs', 'ddd'), /\.md$/).filter((file) => !file.endsWith('05-template-management.md')),
      join(repoRoot, 'docs', 'database-schemas.md'),
      join(repoRoot, 'docs', 'plano-implementacao.md')
    ];

    for (const file of [...codeFiles, ...documentationFiles]) {
      const content = readFileSync(file, 'utf8');

      for (const token of forbiddenTokens) {
        expect(content).not.toContain(token);
      }
    }
  });

  it('documents compatibilityKey in processing_results and keeps template collections out of the MVP schema', () => {
    const databaseSchemas = readFileSync(join(repoRoot, 'docs', 'database-schemas.md'), 'utf8');

    expect(databaseSchemas).toContain('| `compatibilityKey` | `string` | Sim |');
    expect(databaseSchemas).toContain('`compatibilityKey + createdAt`');
    expect(databaseSchemas).not.toMatch(/^## `templates`$/m);
    expect(databaseSchemas).not.toMatch(/^## `template_versions`$/m);
  });

  it('keeps worker Mongo ownership focused on page artifacts and dead-letter records instead of template storage', () => {
    const workerMongoAdapter = readFileSync(
      join(repoRoot, 'apps', 'document-processing-worker', 'src', 'adapters', 'out', 'repositories', 'mongodb.repositories.ts'),
      'utf8'
    );

    expect(workerMongoAdapter).toContain("collection<PageArtifactRecord>('page_artifacts')");
    expect(workerMongoAdapter).toContain("collection<DeadLetterRecord>('dead_letter_events')");
    expect(workerMongoAdapter).not.toContain("'templates'");
    expect(workerMongoAdapter).not.toContain("'template_versions'");
  });
});
