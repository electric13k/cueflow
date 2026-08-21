import { describe, expect, it } from "vitest";
import { newDeck } from "./deck";
import { deckToPptx } from "./pptx";

describe("CueFlow PPTX export", () => {
  it("creates an Office Open XML presentation from the app-native deck", async () => {
    const deck = newDeck();
    deck.slides[0].title = "Cue one";
    const file = await deckToPptx(deck, {}, "test deck");
    expect(file.name).toBe("test deck.pptx");
    expect(file.type).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(file.size).toBeGreaterThan(500);
  });
});
