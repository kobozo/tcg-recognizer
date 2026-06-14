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
  model_version: string;
  /**
   * Opt-in OCR + Qdrant text channel: the OCR'd text and the source tag for the
   * extra candidates folded into `name.candidates`. Present only when the
   * `extras` OCR channel is enabled (OCR_QDRANT).
   */
  ocr?: { text: string; source: string };
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
