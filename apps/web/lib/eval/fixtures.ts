/**
 * Hand-written groundedness fixtures (sub-project 7).
 *
 * Each case pairs a collection `context` + `question` with two answers: a
 * `grounded` one (supported only by the context) and a `hallucinated` one
 * (invents facts not in the context). The LLM-judge eval (scripts/eval-assistant
 * .sh) scores both and asserts the grounded answers score higher on average —
 * verifying the judge meaningfully separates faithful from fabricated answers.
 */
export type GroundednessCase = {
  name: string;
  context: string;
  question: string;
  /** An answer supported only by the context. */
  grounded: string;
  /** An answer that invents facts not present in the context. */
  hallucinated: string;
};

export const GROUNDEDNESS_FIXTURES: GroundednessCase[] = [
  {
    name: "set-completion",
    context:
      "Total cards: 42\n" +
      "Games: Pokémon\n" +
      "Set completion (game · set: owned/total, value):\n" +
      "- Pokémon · Base Set: 38/102, €120.00\n" +
      "- Pokémon · Jungle: 4/64, €15.00",
    question: "How close am I to completing Base Set?",
    grounded:
      "You own 38 of the 102 cards in Base Set, so you still need 64 more to complete it.",
    hallucinated:
      "You're almost done — you own 95 of 102 Base Set cards, just 7 short, and the set is worth over €800.",
  },
  {
    name: "total-value",
    context:
      "Total cards: 10\n" +
      "Total estimated value: €230.00\n" +
      "Games: Pokémon",
    question: "What is my collection worth?",
    grounded: "Your collection's total estimated value is €230.00 across 10 cards.",
    hallucinated:
      "Your collection is worth about $1,500, driven mainly by a graded Charizard valued at $900.",
  },
  {
    name: "most-valuable-card",
    context:
      "Recent cards (up to 60):\n" +
      "- Pokémon | Charizard | Base Set | Rare Holo €90.00\n" +
      "- Pokémon | Pikachu | Jungle | Common €2.00\n" +
      "- Pokémon | Blastoise | Base Set | Rare Holo €45.00",
    question: "Which of my cards is the most valuable?",
    grounded:
      "Your most valuable card is the Base Set Charizard (Rare Holo) at €90.00, ahead of Blastoise at €45.00.",
    hallucinated:
      "Your most valuable card is a Mewtwo from the Neo Genesis set, estimated at €260.00.",
  },
  {
    name: "empty-collection",
    context: "The collection is currently empty.",
    question: "What should I sell?",
    grounded:
      "Your collection is currently empty, so there's nothing to sell yet — scan some cards first.",
    hallucinated:
      "You should sell your duplicate Umbreon and the two Charizards you scanned last week.",
  },
  {
    name: "game-coverage",
    context:
      "Total cards: 20\n" +
      "Games: Pokémon, Magic: The Gathering\n" +
      "Set completion (game · set: owned/total, value):\n" +
      "- Magic: The Gathering · Dominaria: 12/280\n" +
      "- Pokémon · Base Set: 8/102",
    question: "Which games are in my collection?",
    grounded:
      "Your collection spans two games: Pokémon (Base Set, 8/102) and Magic: The Gathering (Dominaria, 12/280).",
    hallucinated:
      "Your collection covers Pokémon, Magic: The Gathering, Yu-Gi-Oh!, and a few Lorcana promos.",
  },
];
