// ============================================================================
// NOVA Gemini client — server-only REST adapter for the Gemini Interactions API
// ============================================================================

const GEMINI_INTERACTIONS_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

const DEFAULT_NOVA_GEMINI_MODEL = "gemini-3.6-flash";
export const NOVA_GEMINI_FALLBACK_MODELS = ["gemini-3.5-flash"] as const;
const MAX_TRANSIENT_RETRIES = 2;
const RETRY_DELAY_MS = [700, 1400] as const;

export const NOVA_GEMINI_MODEL =
  process.env.NOVA_GEMINI_MODEL?.trim() || DEFAULT_NOVA_GEMINI_MODEL;

export const NOVA_GEMINI_FALLBACK_MODEL =
  process.env.NOVA_GEMINI_FALLBACK_MODEL?.trim() || NOVA_GEMINI_FALLBACK_MODELS[0];

export interface GeminiFunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GeminiFunctionCallStep {
  type: "function_call";
  name: string;
  id: string;
  arguments?: unknown;
}

export interface GeminiInteraction {
  id: string;
  output_text?: string;
  steps?: Array<{
    type?: string;
    name?: string;
    id?: string;
    arguments?: unknown;
  }>;
}

export type GeminiInput =
  | string
  | Array<{
      type: "function_result";
      name: string;
      call_id: string;
      result: Array<{ type: "text"; text: string }>;
    }>;

export class GeminiApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GeminiApiError";
    this.status = status;
  }
}

function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error("NOVA_GEMINI_NOT_CONFIGURED");
  }
  return key;
}

function isValidInteractionPayload(value: unknown): value is GeminiInteraction {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.id === "string" && Array.isArray(obj.steps);
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestGemini(
  body: Record<string, unknown>
): Promise<GeminiInteraction> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
    try {
      const response = await fetch(GEMINI_INTERACTIONS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": getGeminiApiKey(),
        },
        body: JSON.stringify(body),
        cache: "no-store",
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          payload.error &&
          typeof payload.error === "object" &&
          "message" in payload.error
            ? String((payload.error as Record<string, unknown>).message)
            : `Gemini API error ${response.status}`;

        const error = new GeminiApiError(message, response.status);
        if (!isTransientStatus(response.status) || attempt === MAX_TRANSIENT_RETRIES) {
          throw error;
        }
        lastError = error;
      } else {
        if (!isValidInteractionPayload(payload)) {
          throw new Error("Réponse Gemini invalide");
        }
        return payload;
      }
    } catch (error) {
      if (error instanceof GeminiApiError) {
        if (!isTransientStatus(error.status) || attempt === MAX_TRANSIENT_RETRIES) {
          throw error;
        }
        lastError = error;
      } else {
        // Les erreurs réseau sont généralement transitoires, mais restent
        // bornées pour éviter de bloquer une action utilisateur.
        if (attempt === MAX_TRANSIENT_RETRIES) throw error;
        lastError = error;
      }
    }

    await sleep(RETRY_DELAY_MS[attempt] ?? RETRY_DELAY_MS[RETRY_DELAY_MS.length - 1]);
  }

  throw lastError instanceof Error ? lastError : new Error("Gemini indisponible");
}

export async function createGeminiInteraction(input: {
  input: GeminiInput;
  systemInstruction: string;
  tools: GeminiFunctionTool[];
  previousInteractionId?: string | null;
  model?: string | null;
}): Promise<GeminiInteraction> {
  return requestGemini({
    model: input.model?.trim() || NOVA_GEMINI_MODEL,
    input: input.input,
    previous_interaction_id: input.previousInteractionId || undefined,
    system_instruction: input.systemInstruction,
    tools: input.tools,
    store: true,
    generation_config: {
      temperature: 0.2,
      max_output_tokens: 1200,
    },
  });
}

export async function createGeminiInteractionWithFallback(input: {
  input: GeminiInput;
  systemInstruction: string;
  tools: GeminiFunctionTool[];
  previousInteractionId?: string | null;
  preferredModel?: string | null;
}): Promise<{ interaction: GeminiInteraction; model: string }> {
  const models = Array.from(
    new Set([
      input.preferredModel?.trim() || NOVA_GEMINI_MODEL,
      NOVA_GEMINI_FALLBACK_MODEL,
      ...NOVA_GEMINI_FALLBACK_MODELS,
    ])
  );

  let lastError: unknown;
  for (const model of models) {
    try {
      return {
        interaction: await createGeminiInteraction({
          input: input.input,
          systemInstruction: input.systemInstruction,
          tools: input.tools,
          previousInteractionId: input.previousInteractionId,
          model,
        }),
        model,
      };
    } catch (error) {
      lastError = error;
      if (!(error instanceof GeminiApiError) || !isTransientStatus(error.status)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini indisponible"); 
}

export function getFunctionCalls(
  interaction: GeminiInteraction
): GeminiFunctionCallStep[] {
  return (interaction.steps ?? []).filter(
    (step): step is GeminiFunctionCallStep =>
      step.type === "function_call" &&
      typeof step.name === "string" &&
      typeof step.id === "string"
  );
}
