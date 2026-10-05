import { describe, expect, it } from "vitest";
import {
  getInteractionOutputText,
  getFunctionCalls,
  type GeminiInteraction,
} from "./gemini-client";

describe("Gemini Interactions REST response helpers", () => {
  it("récupère le texte depuis output_text quand il est présent", () => {
    const interaction: GeminiInteraction = {
      id: "i-1",
      output_text: " Réponse NOVA ",
      steps: [],
    };

    expect(getInteractionOutputText(interaction)).toBe("Réponse NOVA");
  });

  it("récupère le texte depuis model_output.steps quand output_text est absent", () => {
    const interaction: GeminiInteraction = {
      id: "i-2",
      steps: [
        { type: "thought", content: [{ type: "text", text: "interne" }] },
        {
          type: "model_output",
          content: [
            { type: "text", text: "Première partie." },
            { type: "text", text: "Deuxième partie." },
          ],
        },
      ],
    };

    expect(getInteractionOutputText(interaction)).toBe(
      "Première partie.\n\nDeuxième partie."
    );
  });

  it("ne confond pas une pensée avec une réponse utilisateur", () => {
    const interaction: GeminiInteraction = {
      id: "i-3",
      steps: [
        { type: "thought", content: [{ type: "text", text: "secret" }] },
        {
          type: "model_output",
          content: [{ type: "text", text: "Réponse sûre." }],
        },
      ],
    };

    expect(getInteractionOutputText(interaction)).toBe("Réponse sûre.");
  });

  it("détecte toujours les function calls", () => {
    const interaction: GeminiInteraction = {
      id: "i-4",
      steps: [
        {
          type: "function_call",
          name: "get_sales",
          id: "call-1",
          arguments: { limit: 10 },
        },
      ],
    };

    expect(getFunctionCalls(interaction)).toHaveLength(1);
    expect(getFunctionCalls(interaction)[0].name).toBe("get_sales");
  });
});
