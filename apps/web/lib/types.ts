export type Prediction = { value: string; conf: number };

export type NamePrediction = Prediction & {
  candidates?: Prediction[];
};

export type CardPredictions = {
  name: NamePrediction;
  type: Prediction;
  set: Prediction;
  rarity: Prediction;
  card_number: Prediction;
  /** The exact recognized card's source id (e.g. "dp3-3"); used to enrich the
   *  precise card (HP/attacks/price) rather than guessing by name. */
  card_id?: string;
  model_version: string;
  /**
   * Opt-in OCR text channel (pgvector-backed): the OCR'd text and the source tag
   * for the extra candidates folded into `name.candidates`. Present only when the
   * `extras` OCR channel is enabled (OCR_ENABLED).
   */
  ocr?: { text: string; source: string };
  /**
   * Opt-in VLM-assisted disambiguation: when the recognizer is uncertain, a
   * vision-language model reads the card and picks from the shortlist. `pick` is
   * a candidate name (or null when the read wasn't in the list), `text` is the
   * card text the VLM read (for explainability), `provider` is the backend used.
   * Present only when the VLM channel is enabled (VLM_ASSIST) and returned a
   * reading.
   */
  vlm?: { pick: string | null; text: string; provider: string };
};

export type Enrichment = {
  hp?: string;
  attacks?: string[];
  /** Market value snapshot at scan time. */
  price?: number;
  currency?: string; // e.g. "USD" | "EUR"
  priceIndicator?: string; // legacy / fallback display
  imageUrl?: string;
};
