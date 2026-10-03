import { unified } from 'unified';
import remarkParse from 'remark-parse';
import YAML from 'yaml';

export type Section = { id: string | null; title: string; level: number; start: number; body_start: number; end: number };
export function sections(text: string): Section[] {
  const { body, prefix } = frontmatter(text);
  const tree = unified().use(remarkParse).parse(body);
  const found: Section[] = [];
  for (const n of tree.children) {
    if (n.type !== 'heading' || n.position?.start.offset === undefined || n.position.end.offset === undefined) continue;
    const raw = body.slice(n.position.start.offset, n.position.end.offset);
    const match = raw.match(/\{#([a-zA-Z0-9][\w.-]*)\}\s*$/);
    found.push({ id: match?.[1] ?? null, title: raw.replace(/^#{1,6}\s+/, '').replace(/\s*\{#[\w.-]+\}\s*$/, ''),
      level: n.depth, start: prefix.length + n.position.start.offset, body_start: prefix.length + n.position.end.offset, end: text.length });
  }
  const ids = found.map(s => s.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate section ID');
  for (let i = 0; i < found.length; i++) found[i].end = found.slice(i + 1).find(n => n.level <= found[i].level)?.start ?? text.length;
  return found;
}
export function frontmatter(text: string): { metadata: Record<string, unknown>; body: string; prefix: string } {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  if (!m) throw new Error('Document requires YAML frontmatter');
  const data = YAML.parse(m[0].replace(/^---\r?\n/, '').replace(/\r?\n---(?:\r?\n|$)$/, ''));
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.type !== 'string' || !data.type.trim()) throw new Error('OKF frontmatter requires a nonempty type');
  return { metadata: data, body: text.slice(m[0].length), prefix: m[0] };
}
export function replaceSection(text: string, sectionId: string, content: string) {
  const s = sections(text).find(s => s.id === sectionId);
  if (!s) throw new Error(`Unknown stable section ID: ${sectionId}`);
  return text.slice(0, s.body_start) + '\n\n' + content.trim() + '\n\n' + text.slice(s.end);
}
export function validateDocument(text: string) { frontmatter(text); sections(text); }
