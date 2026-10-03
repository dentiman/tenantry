import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { previewSource, serializePreview } from '../libs/shared/src/ai/knowledge/ingest/preview';

function main(): void {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      manifest: { type: 'string' },
      source: { type: 'string' },
      output: { type: 'string' },
      json: { type: 'boolean' },
      'include-content': { type: 'boolean' },
      help: { type: 'boolean' },
    },
    strict: true,
  });
  if (values.help) {
    console.log(
      'pnpm ai:docs:preview --root <checkout> --manifest <json> [--source fms] [--output <report.json>] [--json] [--include-content]',
    );
    return;
  }
  if (!values.root || !values.manifest) throw new Error('--root and --manifest are required');
  const input: unknown = JSON.parse(readFileSync(values.manifest, 'utf8'));
  const preview = previewSource(values.root, input);
  if (values.source && values.source !== preview.sourceKey)
    throw new Error('--source does not match the manifest sourceKey');
  const report = serializePreview(preview, values['include-content']);
  if (values.output) writeFileSync(values.output, report);
  if (values.json) process.stdout.write(report);
  else {
    console.log(`Source ${preview.sourceKey} (${preview.product}), revision ${preview.revision}`);
    console.log(
      `${String(preview.totals.documents)} admitted, ${String(preview.totals.rejected)} rejected, ${String(preview.totals.chunks)} chunks, ${String(preview.totals.embeddingTokens)} embedding tokens (${preview.tokenizer}, includes headings/overlap)`,
    );
    const reasons = new Map<string, number>();
    for (const entry of preview.rejected)
      reasons.set(entry.reason, (reasons.get(entry.reason) ?? 0) + 1);
    for (const [reason, count] of [...reasons].sort()) console.log(`  ${reason}: ${String(count)}`);
    if (values.output) console.log(`Report: ${values.output}`);
  }
  if (preview.totals.documents === 0) process.exitCode = 2;
}
try {
  main();
} catch (error) {
  console.error(`ai:docs:preview: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
