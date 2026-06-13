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
};

export type Enrichment = {
  hp?: string;
  attacks?: string[];
  priceIndicator?: string;
  imageUrl?: string;
};
