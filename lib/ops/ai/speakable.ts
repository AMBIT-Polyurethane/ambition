// Markdown and source markers out, so an answer reads the way a person would say it (used by the server
// when an answer comes without a spoken part, and by the device's own voice).
export function speakable(md: string): string {
  return md
    .replace(/\[\[\/?SAY\]\]/g, "")
    .replace(/⟦[\d,\s]+⟧/g, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[*_]([^*_]+)[*_]/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*(\d+)\.\s+/gm, "")
    .replace(/(\d)\s*bf\b/gi, "$1 board feet")
    .replace(/\bbf\/set\b/gi, "board feet per set")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 1400);
}
