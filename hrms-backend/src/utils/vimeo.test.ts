import { describe, expect, it } from "bun:test";
import { hashOf, toVimeoVideo, vimeoEmbedUrl } from "./vimeo.js";

const base = {
  uri: "/videos/1029384756", name: "Refund call training", duration: 522.4, link: "https://vimeo.com/1029384756",
  player_embed_url: "https://player.vimeo.com/video/1029384756?h=ab12cd34ef", status: "available",
  privacy: { view: "anybody", embed: "public" },
  pictures: { sizes: [{ width: 100, link: "https://i.vimeocdn.com/s.jpg" }, { width: 295, link: "https://i.vimeocdn.com/m.jpg" }] },
};

describe("toVimeoVideo", () => {
  it("reads a public video HRMS can play", () => {
    expect(toVimeoVideo(base)).toEqual({
      id: "1029384756", hash: "ab12cd34ef", name: "Refund call training", durationSeconds: 522,
      thumbnail: "https://i.vimeocdn.com/m.jpg", link: "https://vimeo.com/1029384756", playable: true, reason: null,
    });
  });

  it("plays unlisted and hidden-from-Vimeo videos, and ones limited to chosen sites", () => {
    expect(toVimeoVideo({ ...base, privacy: { view: "unlisted", embed: "public" } }).playable).toBe(true);
    expect(toVimeoVideo({ ...base, privacy: { view: "disable", embed: "whitelist" } }).playable).toBe(true);
  });

  it("refuses what joiners can't watch, saying what to change in Vimeo", () => {
    expect(toVimeoVideo({ ...base, privacy: { view: "nobody", embed: "public" } }).reason).toContain("Private");
    expect(toVimeoVideo({ ...base, privacy: { view: "password", embed: "public" } }).reason).toContain("password");
    expect(toVimeoVideo({ ...base, privacy: { view: "anybody", embed: "private" } }).reason).toContain("Embedding");
    expect(toVimeoVideo({ ...base, status: "transcoding" }).reason).toContain("processing");
    expect(toVimeoVideo({ ...base, duration: 0 }).playable).toBe(false);
  });
});

describe("hashOf and vimeoEmbedUrl", () => {
  it("finds an unlisted video's hash in either place Vimeo gives it", () => {
    expect(hashOf({ player_embed_url: "https://player.vimeo.com/video/1?h=abc123" })).toBe("abc123");
    expect(hashOf({ link: "https://vimeo.com/1029384756/ff00aa" })).toBe("ff00aa");
    expect(hashOf({ link: "https://vimeo.com/1029384756" })).toBe("");
  });

  it("builds a player with the extras off, carrying the hash only when there is one", () => {
    const url = new URL(vimeoEmbedUrl("1029384756", "ab12"));
    expect(url.origin + url.pathname).toBe("https://player.vimeo.com/video/1029384756");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ h: "ab12", dnt: "1", keyboard: "0", speed: "0", title: "0" });
    expect(new URL(vimeoEmbedUrl("1", "")).searchParams.has("h")).toBe(false);
  });
});
