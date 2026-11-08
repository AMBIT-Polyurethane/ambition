// What AMBIT Intelligence says out loud while it looks something up, so a spoken question never meets
// dead air. Keyed by the status line the server sends (lib/ops/ai/tools.ts toolStatus). These exact
// phrases are the only words the voice will say without a server signature (app/api/ops/voice).

export const FILLERS: Record<string, string[]> = {
  "Checking the schedule…": ["One sec, pulling up the schedule.", "Let me look at the board."],
  "Pulling up your numbers…": ["Let me pull your numbers.", "One sec, running the numbers."],
  "Opening the record…": ["Let me pull that up.", "Grabbing that now."],
  "Looking that up…": ["Let me look that up.", "One sec."],
  "Checking follow-ups…": ["Let me see who's waiting on you."],
  "Checking stock…": ["Let me check what's on the shelf."],
  "Searching AMBIT knowledge…": ["Let me check AMBIT's docs on that.", "Let me check the TSBs on that."],
  "Filling in the lead…": ["Writing that up."],
  "Writing the reminder…": ["Got it, writing that down."],
};

export const ALL_FILLERS = new Set(Object.values(FILLERS).flat());

export function fillerFor(status: string): string | null {
  const list = FILLERS[status];
  if (!list?.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/** Said by the guide's coach (no signature needed: fixed words). */
export const COACH_DONE = "Nice, that's done. On to the next one?";
export const COACH_LAST = "Nice, that was the last one.";
