import { describe, expect, it } from "bun:test";
import { videoLink } from "./videoLink.js";

describe("videoLink", () => {
  it("takes Google Drive, YouTube and Vimeo video links", () => {
    expect(videoLink("https://drive.google.com/file/d/1AbC/view?usp=sharing")?.host).toBe("Google Drive");
    expect(videoLink(" https://youtu.be/dQw4w9WgXcQ ")?.host).toBe("YouTube");
    expect(videoLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.host).toBe("YouTube");
    expect(videoLink("https://vimeo.com/1029384756/ab12cd")?.host).toBe("Vimeo");
  });

  it("refuses everything else — other sites, plain http, front pages, credentials, not-a-link", () => {
    expect(videoLink("https://example.com/video.mp4")).toBeNull();
    expect(videoLink("http://youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(videoLink("https://www.youtube.com/")).toBeNull();
    expect(videoLink("https://user:pw@vimeo.com/1")).toBeNull();
    expect(videoLink("https://drive.google.com.evil.io/file/d/1")).toBeNull();
    expect(videoLink("my video")).toBeNull();
  });
});
