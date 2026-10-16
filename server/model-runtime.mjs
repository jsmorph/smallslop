import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const preferredModels = [
  ["openai-codex", "gpt-5.6-sol"],
  ["openai", "gpt-5.1-codex"],
  ["openai", "gpt-5"],
];

export function selectPiModel(availableModels, credentials = []) {
  const storedProviders = new Set(credentials.map(({ providerId }) => providerId));
  const candidates = storedProviders.size
    ? availableModels.filter((model) => storedProviders.has(model.provider))
    : availableModels;
  for (const [provider, modelId] of preferredModels) {
    const model = candidates.find(
      (candidate) => candidate.provider === provider && candidate.id === modelId,
    );

    if (model) {
      return model;
    }
  }

  return candidates[0] ?? null;
}

export async function createPiModelRuntime() {
  const modelRuntime = await ModelRuntime.create();
  const credentials = await modelRuntime.listCredentials();
  const model = selectPiModel(await modelRuntime.getAvailable(), credentials);

  if (!model) {
    throw new Error(
      credentials.length
        ? "No Pi model is available for the credentials in auth.json. Check the stored provider credentials."
        : "No Pi model is available. Configure Pi credentials or set OPENAI_API_KEY.",
    );
  }

  return { model, modelRuntime };
}
