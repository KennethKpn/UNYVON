// ============================================================================
// NOVA Gemini client — server-only REST adapter for the Gemini Interactions API
// ============================================================================

const GEMINI_INTERACTIONS_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

export const NOVA_GEMINI_MODEL =
  process.env.NOVA_GEMINI_MODEL?.trim() || "gemini-3.8-flash";

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

async function requestGemini(body: Record<string, unknown>): Promise<GeminiInteraction> {
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

    throw new Error(message);
  }

  if (!isValidInteractionPayload(payload)) {
    throw new Error("Réponse Gemini invalide");
  }

  return payload;
}

export async function createGeminiInteraction(input: {
  input: GeminiInput;
  systemInstruction: string;
  tools: GeminiFunctionTool[];
  previousInteractionId?: string | null;
}): Promise<GeminiInteraction> {
  return requestGemini({
    model: NOVA_GEMINI_MODEL,
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
