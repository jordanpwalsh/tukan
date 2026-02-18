export type PanePreviewMap = Map<string, string[]>; // windowId → lines

/** Minimum idle seconds before showing preview */
export const PREVIEW_IDLE_THRESHOLD_S = 5;

/** Max lines to show in the preview */
export const PREVIEW_MAX_LINES = 3;

/**
 * Extract the last N non-blank lines from raw pane content.
 */
export function extractPreviewLines(
  rawContent: string,
  maxLines: number = PREVIEW_MAX_LINES,
): string[] {
  const lines = rawContent.split("\n").map((l) => l.trimEnd());
  const nonBlank = lines.filter((l) => l.length > 0);
  if (nonBlank.length === 0) return [];
  return nonBlank.slice(-maxLines);
}

/**
 * Build a windowId → preview lines map from pane contents.
 * For multi-pane windows, uses the first pane encountered.
 */
export function buildPreviewMap(
  paneContents: Map<string, string>,
  paneToWindow: Map<string, string>,
  maxLines: number = PREVIEW_MAX_LINES,
): PanePreviewMap {
  const result: PanePreviewMap = new Map();

  for (const [paneId, content] of paneContents) {
    const windowId = paneToWindow.get(paneId);
    if (!windowId) continue;
    if (result.has(windowId)) continue;

    const lines = extractPreviewLines(content, maxLines);
    if (lines.length > 0) {
      result.set(windowId, lines);
    }
  }

  return result;
}

/**
 * Whether a card should display its pane preview.
 * Shows for any card with a live window that has been idle long enough.
 */
export function shouldShowPreview(
  card: { spinning: boolean; windowId: string | null; closed: boolean; idleTime: number | null },
  thresholdSeconds: number = PREVIEW_IDLE_THRESHOLD_S,
): boolean {
  if (!card.windowId) return false;
  if (card.closed) return false;
  if (card.spinning) return false;
  if (card.idleTime === null) return false;
  return card.idleTime >= thresholdSeconds;
}
